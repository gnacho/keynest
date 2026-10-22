// airbnb-payments.test.ts — plazos de estancias largas (#298): parseo de
// importes es-ES, normalización del volcado del scraper, ingesta idempotente y
// aviso el mismo día en que Airbnb emite el pago (no al confirmarse en banco).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../src/db.js'
import type { DB } from '../src/db.js'
import {
  parseImporteES,
  microsAEuros,
  normalizarPagos,
  ingerirPagos,
  pagadoDeReserva,
  avisarPagosNuevos,
  leerPagosDeDisco,
  esEmitido,
  refPlazo,
} from '../src/airbnb-payments.js'

let dir: string
let db: DB

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-pagos-'))
  process.env.AIRBNB_DATA_DIR = dir
  db = openDb(join(dir, 'test.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.AIRBNB_DATA_DIR
})

const LISTING_PISETE = '935312538627141204'

function seedReserva(code = 'HM3STN8Y4F', ownerId: string | null = 'u1'): { resId: string; propId: string } {
  const propId = `p_${code}`
  db.prepare(
    'INSERT INTO properties (id, name, slug, owner_id, ical_url, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    propId,
    'Pisete',
    `pisete-${code.toLowerCase()}`,
    ownerId,
    `https://www.airbnb.com/calendar/ical/${LISTING_PISETE}.ics?t=tok`,
    Date.now()
  )
  const resId = `r_${code}`
  db.prepare(
    `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(resId, propId, `uid_${code}`, '2026-10-21', '2027-02-26', 'Alexandru Constantin', code, Date.now())
  return { resId, propId }
}

/** Una fila tal como la devuelve FetchProductTransactions (esquema real). */
function fila(opts: {
  code?: string
  amount?: string
  status?: string
  releaseAt?: string
  listingId?: string
}): any {
  return {
    productConfirmationCode: opts.code ?? 'HM3STN8Y4F',
    hostingId: opts.listingId ?? LISTING_PISETE,
    nights: 128,
    currencyAmount: {
      nativeCurrencyAmountFormatted: {
        amountFormatted: opts.amount ?? '2051,86\u00a0\u20ac',
        amountMicros: '2051860000',
        currency: 'EUR',
      },
    },
    readyForReleaseAtTimestamp: opts.releaseAt ?? '2026-10-22T10:20:11.000Z',
    transactionStatus: { status: opts.status ?? 'SENT_TODAY' },
  }
}

const volcado = {
  data: {
    payout_transaction_history: {
      fetchProductTransactions: {
        productTransactions: [fila({})],
      },
    },
  },
}

/** Los 4 plazos reales de Pisete, tal como están hoy en Cobros pendientes. */
const PLAZOS_PISETE = [
  fila({ amount: '2051,86\u00a0\u20ac', status: 'SENT_TODAY', releaseAt: '2026-10-22T10:20:11.000Z' }),
  fila({ amount: '1985,68\u00a0\u20ac', status: 'SCHEDULED', releaseAt: '2026-11-22T11:20:11.000Z' }),
  fila({ amount: '2051,86\u00a0\u20ac', status: 'SCHEDULED', releaseAt: '2026-12-22T11:20:11.000Z' }),
  fila({ amount: '2051,86\u00a0\u20ac', status: 'SCHEDULED', releaseAt: '2027-01-22T11:20:11.000Z' }),
]

describe('parseImporteES', () => {
  it('lee importes es-ES con separador de millares y coma decimal', () => {
    expect(parseImporteES('2.051,86 €')).toBe(2051.86)
    expect(parseImporteES('8.472,22 €')).toBe(8472.22)
    expect(parseImporteES('915,52 €')).toBe(915.52)
  })

  it('admite punto decimal anglosajón y rechaza basura', () => {
    expect(parseImporteES('2051.86')).toBe(2051.86)
    expect(parseImporteES('')).toBeNull()
    expect(parseImporteES(null)).toBeNull()
    expect(parseImporteES('sin importe')).toBeNull()
  })
})

describe('microsAEuros', () => {
  it('convierte micros a euros con dos decimales', () => {
    expect(microsAEuros('2051860000')).toBe(2051.86)
    expect(microsAEuros(438750000)).toBe(438.75)
    expect(microsAEuros(null)).toBeNull()
  })
})

describe('esEmitido', () => {
  it('considera emitidos SENT_TODAY y compañía, pero no los programados', () => {
    expect(esEmitido('SENT_TODAY')).toBe(true)
    expect(esEmitido('SENT')).toBe(true)
    expect(esEmitido('PAID')).toBe(true)
    expect(esEmitido('SCHEDULED')).toBe(false)
    expect(esEmitido('')).toBe(false)
    expect(esEmitido(null)).toBe(false)
  })
})

describe('refPlazo', () => {
  it('distingue dos plazos del mismo importe y reserva por su fecha', () => {
    const a = refPlazo('2026-12-22', 2051.86, 'HM3STN8Y4F')
    const b = refPlazo('2027-01-22', 2051.86, 'HM3STN8Y4F')
    expect(a).not.toBe(b)
  })
})

describe('normalizarPagos', () => {
  it('aplana la respuesta de FetchProductTransactions', () => {
    const pagos = normalizarPagos(volcado)
    expect(pagos).toHaveLength(1)
    expect(pagos[0]).toMatchObject({
      confirmationCode: 'HM3STN8Y4F',
      listingId: LISTING_PISETE,
      emittedOn: '2026-10-22',
      amount: 2051.86,
      currency: 'EUR',
      status: 'SENT_TODAY',
    })
  })

  it('no colapsa los plazos repetidos de una misma reserva', () => {
    const pagos = normalizarPagos(PLAZOS_PISETE)
    expect(pagos).toHaveLength(4)
    expect(pagos.map((p) => p.emittedOn)).toEqual(['2026-10-22', '2026-11-22', '2026-12-22', '2027-01-22'])
  })

  it('acepta la lista de productTransactions ya extraída', () => {
    expect(normalizarPagos([fila({})])).toHaveLength(1)
  })

  it('descarta filas sin código o sin importe', () => {
    const pagos = normalizarPagos([
      { ...fila({}), productConfirmationCode: '' },
      { ...fila({}), currencyAmount: { nativeCurrencyAmountFormatted: {} } },
      fila({}),
    ])
    expect(pagos).toHaveLength(1)
  })
})

describe('ingerirPagos', () => {
  it('registra el plazo y lo vincula a la reserva por confirmation_code', () => {
    const { resId } = seedReserva()
    ingerirPagos(db, normalizarPagos(volcado))
    const f = db.prepare('SELECT reservation_id, amount, paid_on, status FROM reservation_payments').get() as {
      reservation_id: string
      amount: number
      paid_on: string
      status: string
    }
    expect(f.reservation_id).toBe(resId)
    expect(f.amount).toBe(2051.86)
    expect(f.paid_on).toBe('2026-10-22')
    expect(f.status).toBe('SENT_TODAY')
  })

  it('es idempotente: reingerir el mismo volcado no duplica', () => {
    seedReserva()
    ingerirPagos(db, normalizarPagos(volcado))
    expect(ingerirPagos(db, normalizarPagos(volcado))).toHaveLength(0)
    const n = (db.prepare('SELECT COUNT(*) c FROM reservation_payments').get() as { c: number }).c
    expect(n).toBe(1)
  })

  it('acumula los cuatro plazos de Pisete y calcula el pagado hasta la fecha', () => {
    seedReserva()
    ingerirPagos(db, normalizarPagos(PLAZOS_PISETE))
    const { total, plazos, ultimo } = pagadoDeReserva(db, 'HM3STN8Y4F')
    expect(plazos).toBe(4)
    expect(total).toBeCloseTo(8141.26, 2) // 2051,86 + 1985,68 + 2051,86 + 2051,86
    expect(ultimo).toBe('2027-01-22')
  })

  it('resuelve el inmueble por listing_id si la reserva aún no está sincronizada', () => {
    const { propId } = seedReserva()
    // Reserva conocida con otro código: el vínculo debe caer por listing_id.
    ingerirPagos(db, normalizarPagos([fila({ code: 'CODIGO-NUEVO' })]))
    const f = db.prepare('SELECT reservation_id FROM reservation_payments').get() as { reservation_id: string }
    const res = db.prepare('SELECT property_id FROM reservations WHERE id = ?').get(f.reservation_id) as {
      property_id: string
    }
    expect(res.property_id).toBe(propId)
  })
})

describe('avisarPagosNuevos', () => {
  it('avisa solo de los plazos ya emitidos, no de los programados', () => {
    seedReserva()
    const notify = vi.fn()
    const pagos = normalizarPagos(PLAZOS_PISETE)
    ingerirPagos(db, pagos)
    const avisados = avisarPagosNuevos(db, notify, pagos)
    expect(avisados).toBe(1) // solo el SENT_TODAY
    expect(notify).toHaveBeenCalledTimes(1)
    const datos = notify.mock.calls[0][3]
    expect(datos.importe).toBe(2051.86)
    expect(datos.propiedad).toBe('Pisete')
    expect(datos.fecha).toBe('2026-10-22')
  })

  it('avisa de un plazo posterior cuando pasa a emitido (mismo día de emisión)', () => {
    seedReserva()
    const notify = vi.fn()
    const programado = normalizarPagos([PLAZOS_PISETE[1]]) // 22-nov, SCHEDULED
    ingerirPagos(db, programado)
    expect(avisarPagosNuevos(db, notify, programado)).toBe(0)

    // El 22-nov Airbnb lo emite: misma fila pero SENT_TODAY.
    const emitido = normalizarPagos([
      fila({ amount: '1985,68\u00a0\u20ac', status: 'SENT_TODAY', releaseAt: '2026-11-22T11:20:11.000Z' }),
    ])
    expect(avisarPagosNuevos(db, notify, emitido, '2026-11-22')).toBe(1)
  })

  it('no repite el aviso al reingerir (dedupe por external_ref)', () => {
    seedReserva()
    const notify = vi.fn()
    const pagos = normalizarPagos(volcado)
    ingerirPagos(db, pagos)
    avisarPagosNuevos(db, notify, pagos)
    expect(avisarPagosNuevos(db, notify, pagos)).toBe(0)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('no avisa si el inmueble no tiene dueño asignado', () => {
    seedReserva('HM3STN8Y4F', null)
    const notify = vi.fn()
    const pagos = normalizarPagos(volcado)
    ingerirPagos(db, pagos)
    expect(avisarPagosNuevos(db, notify, pagos)).toBe(0)
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('leerPagosDeDisco', () => {
  it('lee el volcado del scraper desde AIRBNB_DATA_DIR', () => {
    writeFileSync(join(dir, 'airbnb_pagos.json'), JSON.stringify(volcado))
    const pagos = leerPagosDeDisco()
    expect(pagos).toHaveLength(1)
    expect(pagos[0].amount).toBe(2051.86)
  })

  it('devuelve lista vacía si el fichero no existe o está corrupto', () => {
    expect(leerPagosDeDisco()).toEqual([])
    writeFileSync(join(dir, 'airbnb_pagos.json'), '{roto')
    expect(leerPagosDeDisco()).toEqual([])
  })
})
