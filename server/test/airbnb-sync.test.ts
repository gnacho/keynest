// airbnb-sync.test.js - cruce del scraper de Airbnb: guests+amount por
// confirmation_code + aviso push de sesión muerta/recuperada (forzar: true).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kvGet, openDb } from '../src/db.js'
import type { DB } from '../src/db.js'
import { aplicarCruce, airbnbStatus, esSolicitudPendiente, expirarSolicitudes, motivoSesion, syncAirbnb, crearPairing, pairingVigente, consumirPairing, guardarSesion, marcarSesionRestaurada, listingIdDePropiedad, mapaListings } from '../src/airbnb-sync.js'

// notifyAll de push.js se mockea para capturar los avisos de sesión.
vi.mock('../src/push.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, any>
  return { ...actual, notifyAll: vi.fn(() => Promise.resolve()) }
})
import { notifyAll } from '../src/push.js'

let dir: string
let dataDir: string
let db: DB
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-airbnb-test-'))
  dataDir = join(dir, 'data')
  mkdirSync(dataDir, { recursive: true })
  process.env.AIRBNB_DATA_DIR = dataDir
  process.env.AIRBNB_SESSION_PATH = join(dir, '.auth/airbnb_session.json')
  db = openDb(dir, 'test.db')
})
afterEach(() => {
  delete process.env.AIRBNB_DATA_DIR
  delete process.env.AIRBNB_SESSION_PATH
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.clearAllMocks()
})

function escribeReservas(reservas: Array<Record<string, any>>, extraido = new Date().toISOString()) {
  writeFileSync(join(dataDir, 'airbnb_reservas.json'), JSON.stringify({ extraido, reservas }))
}
function escribeSesion(viva: boolean, detalle: string | null = null) {
  writeFileSync(join(dataDir, 'airbnb_sesion.json'), JSON.stringify({ viva, detalle: detalle ?? null }))
}
function insertaReserva(id: string, code: string, extra: Record<string, any> = {}) {
  db.prepare(
    `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, guest_name, booked_date, created_at, airbnb_sync_state)
     VALUES (?, 'p1', ?, ?, ?, 'A', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    extra.uid ?? `uid-${id}`,
    extra.checkin ?? '2026-08-10',
    extra.checkout ?? '2026-08-12',
    code,
    extra.guest_name ?? '',
    extra.booked_date ?? '',
    extra.created_at ?? Date.now(),
    extra.airbnb_sync_state ?? '',
  )
}

describe('aplicarCruce', () => {
  it('actualiza guests y amount por confirmation_code y cuenta sinMatch', () => {
    insertaReserva('res-1', 'HM1')
    escribeReservas([
      { confirmation_code: 'HM1', guests: 3, amount: 220.5 },
      { confirmation_code: 'HM-NO-EXISTE', guests: 2, amount: 100 },
    ])
    const res = aplicarCruce(db)
    expect(res.cruzadas).toBe(1)
    expect(res.sinMatch).toBe(1)
    const fila = db.prepare('SELECT guests, amount FROM reservations WHERE id = ?').get('res-1') as { guests: number; amount: number }
    expect(fila.guests).toBe(3)
    expect(fila.amount).toBe(220.5)
  })

  it('rellena guest_name y booked_date cuando la reserva los tiene vacíos', () => {
    insertaReserva('res-2', 'HM2')
    escribeReservas([
      { confirmation_code: 'HM2', guests: 4, amount: 300, guest_name: 'Laith Kawar', booked_date: '2026-05-01' },
    ])
    aplicarCruce(db)
    const fila = db.prepare('SELECT guest_name, booked_date FROM reservations WHERE id = ?').get('res-2') as { guest_name: string; booked_date: string }
    expect(fila.guest_name).toBe('Laith Kawar')
    expect(fila.booked_date).toBe('2026-05-01')
  })

  it('no pisa guest_name ni booked_date existentes (edición manual/CSV)', () => {
    insertaReserva('res-3', 'HM3', { guest_name: 'Nombre Manual', booked_date: '2026-01-01' })
    escribeReservas([
      { confirmation_code: 'HM3', guests: 2, amount: 100, guest_name: 'Nombre Scraper', booked_date: '2026-06-01' },
    ])
    aplicarCruce(db)
    const fila = db.prepare('SELECT guest_name, booked_date FROM reservations WHERE id = ?').get('res-3') as { guest_name: string; booked_date: string }
    expect(fila.guest_name).toBe('Nombre Manual')
    expect(fila.booked_date).toBe('2026-01-01')
  })

  it('no borra el guest_name existente si el scraper no trae nombre', () => {
    insertaReserva('res-4', 'HM4', { guest_name: 'Nombre Previo' })
    escribeReservas([{ confirmation_code: 'HM4', guests: 1, amount: 50 }])
    aplicarCruce(db)
    const fila = db.prepare('SELECT guest_name FROM reservations WHERE id = ?').get('res-4') as { guest_name: string }
    expect(fila.guest_name).toBe('Nombre Previo')
  })

  it('rellena guest_location cuando la reserva lo tiene vacío', () => {
    insertaReserva('res-5', 'HM5')
    escribeReservas([
      { confirmation_code: 'HM5', guests: 2, amount: 100, guest_location: 'Vilnius, Lithuania' },
    ])
    aplicarCruce(db)
    const fila = db.prepare('SELECT guest_location FROM reservations WHERE id = ?').get('res-5') as { guest_location: string }
    expect(fila.guest_location).toBe('Vilnius, Lithuania')
  })

  it('no pisa guest_location existente y aguanta scraper sin el campo', () => {
    insertaReserva('res-6', 'HM6')
    db.prepare("UPDATE reservations SET guest_location = 'Berlin, Germany' WHERE id = ?").run('res-6')
    escribeReservas([
      { confirmation_code: 'HM6', guests: 2, amount: 100, guest_location: 'Hamburg, Germany' },
      { confirmation_code: 'HM7', guests: 1, amount: 40 },
    ])
    insertaReserva('res-7', 'HM7')
    aplicarCruce(db)
    const f6 = db.prepare('SELECT guest_location FROM reservations WHERE id = ?').get('res-6') as { guest_location: string }
    expect(f6.guest_location).toBe('Berlin, Germany')
    const f7 = db.prepare('SELECT guest_location FROM reservations WHERE id = ?').get('res-7') as { guest_location: string }
    expect(f7.guest_location).toBe('')
  })

  it('mantiene pendiente una reserva iCal creada después de la instantánea', () => {
    const created = Date.parse('2026-10-26T19:14:21.397Z')
    insertaReserva('res-nueva', 'HM-NUEVA', {
      uid: 'nueva@airbnb.com',
      created_at: created,
      checkin: '2026-11-25',
      checkout: '2027-01-25',
      airbnb_sync_state: 'pending',
    })
    escribeReservas([], '2026-10-26T19:04:13.870Z')

    aplicarCruce(db)

    const fila = db.prepare('SELECT airbnb_sync_state, airbnb_synced_at FROM reservations WHERE id = ?').get('res-nueva') as {
      airbnb_sync_state: string
      airbnb_synced_at: number | null
    }
    expect(fila.airbnb_sync_state).toBe('pending')
    expect(fila.airbnb_synced_at).toBeNull()
  })

  it('marca missing solo cuando una instantánea posterior no contiene el código', () => {
    const created = Date.parse('2026-10-26T19:14:21.397Z')
    const extracted = Date.parse('2026-10-26T20:04:13.870Z')
    insertaReserva('res-ausente', 'HM-AUSENTE', {
      uid: 'ausente@airbnb.com',
      created_at: created,
      checkin: '2026-11-25',
      checkout: '2027-01-25',
      airbnb_sync_state: 'pending',
    })
    escribeReservas([], '2026-10-26T20:04:13.870Z')

    aplicarCruce(db)

    const fila = db.prepare('SELECT airbnb_sync_state, airbnb_synced_at FROM reservations WHERE id = ?').get('res-ausente') as {
      airbnb_sync_state: string
      airbnb_synced_at: number | null
    }
    expect(fila.airbnb_sync_state).toBe('missing')
    expect(fila.airbnb_synced_at).toBe(extracted)
  })

  it('guarda el estado real de Airbnb al cruzar la reserva', () => {
    const extracted = Date.parse('2026-10-26T20:04:13.870Z')
    insertaReserva('res-estado', 'HM-ESTADO', {
      uid: 'estado@airbnb.com',
      created_at: Date.parse('2026-10-26T19:14:21.397Z'),
    })
    escribeReservas([{
      confirmation_code: 'HM-ESTADO',
      guests: 3,
      amount: 6020.25,
      status: 'request',
      status_localized: 'Pendiente',
      cancellation_status: 'PENDING_REVIEW',
    }], '2026-10-26T20:04:13.870Z')

    aplicarCruce(db)

    const fila = db.prepare(`SELECT airbnb_sync_state, airbnb_synced_at, airbnb_status,
      airbnb_status_localized, airbnb_cancellation_status, guests, amount
      FROM reservations WHERE id = ?`).get('res-estado') as Record<string, any>
    expect(fila).toMatchObject({
      airbnb_sync_state: 'matched',
      airbnb_synced_at: extracted,
      airbnb_status: 'request',
      airbnb_status_localized: 'Pendiente',
      airbnb_cancellation_status: 'PENDING_REVIEW',
      guests: 3,
      amount: 6020.25,
    })
  })

  it('resuelve en un solo cruce una solicitud pendiente que la instantánea ya traía (#330)', () => {
    insertaReserva('res-solicitud', 'HM-SOLICITUD', {
      uid: 'solicitud@airbnb.com',
      airbnb_sync_state: 'pending',
    })
    escribeReservas([{
      confirmation_code: 'HM-SOLICITUD',
      guests: 4,
      amount: 2510.47,
      guest_name: 'Laith Kawar',
      status: 'pending',
      status_localized: 'Reserva solicitada',
    }])

    aplicarCruce(db)

    const fila = db.prepare(`SELECT airbnb_sync_state, airbnb_status, airbnb_status_localized,
      guests, amount, guest_name FROM reservations WHERE id = ?`).get('res-solicitud') as Record<string, any>
    expect(fila).toMatchObject({
      airbnb_sync_state: 'matched',
      airbnb_status: 'pending',
      airbnb_status_localized: 'Reserva solicitada',
      guests: 4,
      amount: 2510.47,
      guest_name: 'Laith Kawar',
    })
  })

  it('no hace retroceder una reserva sincronizada con una instantánea antigua', () => {
    insertaReserva('res-reciente', 'HM-RECIENTE', {
      uid: 'reciente@airbnb.com',
      created_at: Date.parse('2026-10-26T19:14:21.397Z'),
    })
    escribeReservas([{ confirmation_code: 'HM-RECIENTE', status: 'upcoming', guests: 3 }], '2026-10-26T20:04:13.870Z')
    aplicarCruce(db)
    escribeReservas([], '2026-10-26T19:04:13.870Z')

    aplicarCruce(db)

    const fila = db.prepare('SELECT airbnb_sync_state, airbnb_status, guests FROM reservations WHERE id = ?').get('res-reciente') as Record<string, any>
    expect(fila).toMatchObject({ airbnb_sync_state: 'matched', airbnb_status: 'upcoming', guests: 3 })
  })

  it('detecta una salida anticipada una sola vez y actualiza las fechas (#356)', () => {
    db.prepare("INSERT INTO properties (id, slug, name, created_at) VALUES ('p1', 'el-47', 'El 47', 0)").run()
    insertaReserva('res-short', 'HM-SHORT', {
      uid: 'short@airbnb.com',
      checkin: '2026-08-10',
      checkout: '2026-08-20',
      guest_name: 'Test Guest',
      airbnb_sync_state: 'matched',
    })
    escribeReservas([{
      confirmation_code: 'HM-SHORT',
      checkin: '2026-08-10',
      checkout: '2026-08-15',
      guests: 1,
      amount: 500,
    }])

    const primera = aplicarCruce(db)

    expect(primera.acortadas).toEqual([{
      reservationId: 'res-short',
      propertyName: 'El 47',
      summary: 'A',
      checkin: '2026-08-10',
      previousCheckout: '2026-08-20',
      checkout: '2026-08-15',
      guestName: 'Test Guest',
      confirmationCode: 'HM-SHORT',
      amount: 500,
    }])
    expect(db.prepare("SELECT checkin, checkout FROM reservations WHERE id = 'res-short'").get()).toEqual({
      checkin: '2026-08-10',
      checkout: '2026-08-15',
    })

    const repetida = aplicarCruce(db)
    expect(repetida.acortadas).toHaveLength(0)

    escribeReservas([{ confirmation_code: 'HM-SHORT', checkin: '2026-08-10', checkout: '2026-08-22' }])
    const ampliada = aplicarCruce(db)
    expect(ampliada.acortadas).toHaveLength(0)
    expect(db.prepare("SELECT checkout FROM reservations WHERE id = 'res-short'").get()).toEqual({ checkout: '2026-08-22' })
  })

  // #334: una cancelación confirmada en el scraper borra en cascada y avisa.
  it('borra reserva, pagos y limpiezas cuando el scraper confirma la cancelación', () => {
    insertaReserva('res-cancel', 'HM-CANCEL', {
      uid: 'cancel@airbnb.com',
      checkin: '2027-01-04',
      checkout: '2027-03-14',
      airbnb_sync_state: 'matched',
    })
    db.prepare(
      `INSERT INTO reservation_payments (id, reservation_id, confirmation_code, paid_on, amount, currency, status, external_ref, detected_at)
       VALUES ('pay-cancel','res-cancel','HM-CANCEL','2027-01-05',2441.5,'EUR','SCHEDULED','ext-cancel',0)`,
    ).run()
    db.prepare(
      `INSERT INTO cleanings (id, property_id, reservation_id, date, status, created_at)
       VALUES ('limp-cancel','p1','res-cancel','2027-03-14','pending',0)`,
    ).run()
    escribeReservas([
      { confirmation_code: 'HM-CANCEL', status: 'cancelled', cancellation_status: 'CANCELLED_BY_GUEST' },
    ])

    const res = aplicarCruce(db)

    expect(res.canceladas).toHaveLength(1)
    expect(res.canceladas[0]).toMatchObject({
      reservationId: 'res-cancel',
      confirmationCode: 'HM-CANCEL',
      checkin: '2027-01-04',
      checkout: '2027-03-14',
      matched: true,
    })
    expect(db.prepare("SELECT COUNT(*) n FROM reservations WHERE id = 'res-cancel'").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT COUNT(*) n FROM reservation_payments WHERE reservation_id = 'res-cancel'").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT COUNT(*) n FROM cleanings WHERE reservation_id = 'res-cancel'").get()).toEqual({ n: 0 })
    const audit = db.prepare("SELECT action, entity, entity_id FROM audit_log WHERE action = 'cancel'").get()
    expect(audit).toEqual({ action: 'cancel', entity: 'reservation', entity_id: 'res-cancel' })
  })

  it('una solicitud pendiente (REQUESTED/PENDING) NO se trata como cancelación', () => {
    insertaReserva('res-pendiente', 'HM-PENDIENTE', {
      uid: 'pendiente@airbnb.com',
      checkin: '2027-01-04',
      checkout: '2027-03-14',
    })
    escribeReservas([
      { confirmation_code: 'HM-PENDIENTE', guests: 2, amount: 900, status: 'request', cancellation_status: 'REQUESTED' },
    ])

    const res = aplicarCruce(db)

    expect(res.canceladas).toHaveLength(0)
    const fila = db.prepare('SELECT airbnb_sync_state, airbnb_cancellation_status FROM reservations WHERE id = ?').get('res-pendiente')
    expect(fila).toMatchObject({ airbnb_sync_state: 'matched', airbnb_cancellation_status: 'REQUESTED' })
  })
})

describe('syncAirbnb', () => {
  it('avisa push crítico (forzar) en el flanco viva->muerta', async () => {
    insertaReserva('res-1', 'HM1')
    escribeReservas([{ confirmation_code: 'HM1', guests: 3, amount: 200 }])
    escribeSesion(false, 'sesión caducada')
    await syncAirbnb(db)
    expect(notifyAll).toHaveBeenCalledWith(
      expect.anything(),
      'airbnb_sesion_caida',
      expect.objectContaining({ detalle: 'sesión caducada' }),
      expect.objectContaining({ severity: 'critical', forzar: true }),
    )
  })

  it('avisa recuperación en el flanco muerta->viva', async () => {
    insertaReserva('res-1', 'HM1')
    escribeReservas([{ confirmation_code: 'HM1', guests: 3, amount: 200 }])
    // Estado previo guardado: sesión muerta (para provocar el flanco).
    db.prepare(`INSERT INTO kv (key, value) VALUES ('airbnb_sesion', ?)`).run(JSON.stringify({ viva: false }))
    escribeSesion(true)
    await syncAirbnb(db)
    expect(notifyAll).toHaveBeenCalledWith(
      expect.anything(),
      'airbnb_sesion_ok',
      expect.anything(),
      expect.objectContaining({ severity: 'normal' }),
    )
  })

  it('avisa por push la salida anticipada al cruzarla con el scraper (#356)', async () => {
    db.prepare("INSERT INTO properties (id, slug, name, created_at) VALUES ('p1', 'el-47', 'El 47', 0)").run()
    insertaReserva('res-short-push', 'HM-SHORT-PUSH', {
      uid: 'short-push@airbnb.com',
      checkin: '2027-01-04',
      checkout: '2027-03-14',
      guest_name: 'Test Guest',
      airbnb_sync_state: 'matched',
    })
    escribeSesion(true)
    escribeReservas([{
      confirmation_code: 'HM-SHORT-PUSH',
      checkin: '2027-01-04',
      checkout: '2027-03-10',
      guest_name: 'Test Guest',
      amount: 500,
    }])

    await syncAirbnb(db)

    expect(notifyAll).toHaveBeenCalledWith(
      expect.anything(),
      'reserva_acortada',
      expect.objectContaining({
        propiedad: 'El 47',
        huesped: 'Test Guest',
        codigo: 'HM-SHORT-PUSH',
        checkin: '2027-01-04',
        checkout_anterior: '2027-03-14',
        checkout: '2027-03-10',
        importe: 500,
      }),
      expect.objectContaining({ severity: 'high', url: '/reservas?reserva=res-short-push' }),
    )
  })

  it('avisa por push la reserva cancelada al cruzarla con el scraper (#334)', async () => {
    insertaReserva('res-cancel-push', 'HM-CANCEL-PUSH', {
      uid: 'cancel-push@airbnb.com',
      checkin: '2027-01-04',
      checkout: '2027-03-14',
      airbnb_sync_state: 'matched',
    })
    escribeSesion(true)
    db.prepare("UPDATE reservations SET amount = 5434.3, guest_name = 'Lisa Buchter' WHERE id = 'res-cancel-push'").run()
    escribeReservas([
      { confirmation_code: 'HM-CANCEL-PUSH', guest_name: 'Lisa Buchter', amount: 5434.3, status: 'cancelled' },
    ])

    await syncAirbnb(db)

    expect(notifyAll).toHaveBeenCalledWith(
      expect.anything(),
      'reserva_cancelada',
      expect.objectContaining({
        resumen: 'A',
        huesped: 'Lisa Buchter',
        codigo: 'HM-CANCEL-PUSH',
        checkin: '2027-01-04',
        checkout: '2027-03-14',
        importe: 5434.3,
      }),
      expect.objectContaining({ severity: 'high', url: '/reservas' }),
    )
  })
})

describe('marcarSesionRestaurada', () => {
  it('marca el kv como viva y avisa recuperación si venía muerta', () => {
    db.prepare(`INSERT INTO kv (key, value) VALUES ('airbnb_sesion', ?)`).run(JSON.stringify({ viva: false }))
    const flanco = marcarSesionRestaurada(db)
    expect(flanco).toBe(true)
    const estado = JSON.parse((db.prepare(`SELECT value FROM kv WHERE key = 'airbnb_sesion'`).get() as { value: string }).value)
    expect(estado.viva).toBe(true)
    expect(notifyAll).toHaveBeenCalledWith(
      expect.anything(),
      'airbnb_sesion_ok',
      expect.anything(),
      expect.objectContaining({ severity: 'normal' }),
    )
  })

  it('no avisa recuperación si el estado anterior ya estaba vivo', () => {
    db.prepare(`INSERT INTO kv (key, value) VALUES ('airbnb_sesion', ?)`).run(JSON.stringify({ viva: true }))
    const flanco = marcarSesionRestaurada(db)
    expect(flanco).toBe(false)
    expect(notifyAll).not.toHaveBeenCalled()
    const estado = JSON.parse((db.prepare(`SELECT value FROM kv WHERE key = 'airbnb_sesion'`).get() as { value: string }).value)
    expect(estado.viva).toBe(true)
  })

  it('no avisa si no hay estado previo (primer arranque)', () => {
    const flanco = marcarSesionRestaurada(db)
    expect(flanco).toBe(false)
    expect(notifyAll).not.toHaveBeenCalled()
  })
})

describe('pairing + guardarSesion', () => {
  it('crea un código de 6 caracteres vigente en kv con caducidad', () => {
    const p = crearPairing(db)
    expect(p.code).toMatch(/^[A-Z2-9]{6}$/)
    expect(p.expira).toBeGreaterThan(Date.now())
    const vigente = pairingVigente(db)
    expect(vigente!.code).toBe(p.code)
  })

  it('pairingVigente devuelve null si está caducado', () => {
    crearPairing(db, Date.now() - 11 * 60 * 1000)
    expect(pairingVigente(db)).toBeNull()
  })

  it('consumirPairing: wrong code o expirado = false; correcto = true y single-use', () => {
    const p = crearPairing(db)
    expect(consumirPairing(db, 'XXXXXX')).toBe(false)
    expect(consumirPairing(db, p.code)).toBe(true)
    expect(pairingVigente(db)).toBeNull()
    expect(consumirPairing(db, p.code)).toBe(false)
  })

  it('guardarSesion escribe el storage_state en mode 600 en AIRBNB_SESSION_PATH', () => {
    const sesion = { cookies: [{ name: 'ucs', value: 'x' }, { name: 'datadome', value: 'y' }], origins: [] }
    const ruta = guardarSesion(sesion)
    expect(ruta).toBe(process.env.AIRBNB_SESSION_PATH)
    const escrito = JSON.parse(readFileSync(ruta, 'utf-8'))
    expect(escrito.cookies).toHaveLength(2)
    expect(escrito.cookies[1]).toEqual({ name: 'datadome', value: 'y' })
    const st = statSync(ruta)
    expect(st.mode & 0o777).toBe(0o600)
  })
})

// El emparejamiento anuncio<->inmueble va por listing_id (el nombre no sirve:
// Keynest usa nombres internos y Airbnb el titulo del anuncio). #298
describe('mapa de listings por listing_id', () => {
  it('extrae el listing_id de la URL del ICS', () => {
    expect(listingIdDePropiedad('https://www.airbnb.com/calendar/ical/935312538627141204.ics?t=abc')).toBe(
      '935312538627141204'
    )
    expect(listingIdDePropiedad('https://www.airbnb.com/calendar/ical/577146229558270702.ics?t=x')).toBe(
      '577146229558270702'
    )
    expect(listingIdDePropiedad('https://otro.com/cal.ics')).toBeNull()
    expect(listingIdDePropiedad(null)).toBeNull()
  })

  it('mapea los cuatro inmuebles reales de Keynest a su listing_id', () => {
    const reales: Array<[string, string, string]> = [
      ['pisete', 'Pisete', '935312538627141204'],
      ['el-47', 'El 47', '577146229558270702'],
      ['camnpanar', 'Campanar', '1607945371495321384'],
      ['apartamento-malvarrosa', 'Entrepinos', '941965992844344229'],
    ]
    for (const [id, name, lid] of reales) {
      db.prepare('INSERT INTO properties (id, name, slug, ical_url, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        name,
        id,
        `https://www.airbnb.com/calendar/ical/${lid}.ics?t=tok`,
        Date.now()
      )
    }
    const mapa = mapaListings(db)
    expect(mapa.size).toBe(4)
    expect(mapa.get('935312538627141204')).toBe('pisete')
    expect(mapa.get('941965992844344229')).toBe('apartamento-malvarrosa')
  })
})

describe('solicitudes nunca confirmadas (#331)', () => {
  const futuro = { checkin: '2030-01-04', checkout: '2030-01-10' }

  it('con la sesión muerta no se declara ausente ninguna reserva', () => {
    insertaReserva('res-1', 'HM1', { ...futuro, uid: 'res-1@airbnb.com' })
    escribeReservas([])
    escribeSesion(false, 'sesión caducada')
    aplicarCruce(db)
    const fila = db.prepare('SELECT airbnb_sync_state, missing_since FROM reservations WHERE id = ?').get('res-1') as any
    expect(fila.airbnb_sync_state).not.toBe('missing')
    expect(fila.missing_since).toBeNull()
  })

  it('con la extracción fallida tampoco, aunque la sesión figure viva', () => {
    insertaReserva('res-1', 'HM1', { ...futuro, uid: 'res-1@airbnb.com' })
    escribeReservas([{ confirmation_code: 'OTRA' }])
    writeFileSync(join(dataDir, 'airbnb_sesion.json'), JSON.stringify({ viva: true, extraccion_ok: false }))
    aplicarCruce(db)
    const fila = db.prepare('SELECT airbnb_sync_state FROM reservations WHERE id = ?').get('res-1') as any
    expect(fila.airbnb_sync_state).not.toBe('missing')
  })

  it('apunta missing_since al ausentarse y lo limpia al reaparecer', () => {
    insertaReserva('res-1', 'HM1', { ...futuro, uid: 'res-1@airbnb.com' })
    escribeSesion(true)
    escribeReservas([{ confirmation_code: 'OTRA' }])
    aplicarCruce(db)
    const ausente = db.prepare('SELECT airbnb_sync_state, missing_since FROM reservations WHERE id = ?').get('res-1') as any
    expect(ausente.airbnb_sync_state).toBe('missing')
    expect(ausente.missing_since).toBeGreaterThan(0)

    escribeReservas([{ confirmation_code: 'HM1', status: 'pending', status_localized: 'Reserva solicitada' }])
    aplicarCruce(db)
    const vuelta = db.prepare('SELECT airbnb_sync_state, missing_since FROM reservations WHERE id = ?').get('res-1') as any
    expect(vuelta.airbnb_sync_state).toBe('matched')
    expect(vuelta.missing_since).toBeNull()
  })

  it('expira la solicitud ausente más de 24 h, con traza y tombstone', () => {
    insertaReserva('res-1', 'HM1', { ...futuro, uid: 'res-1@airbnb.com' })
    db.prepare("UPDATE reservations SET airbnb_status = 'pending', airbnb_status_localized = 'Reserva solicitada', missing_since = ? WHERE id = ?")
      .run(Date.now() - 25 * 3600 * 1000, 'res-1')
    const expiradas = expirarSolicitudes(db)
    expect(expiradas).toHaveLength(1)
    expect(db.prepare('SELECT COUNT(*) n FROM reservations WHERE id = ?').get('res-1')).toEqual({ n: 0 })
    const audit = db.prepare("SELECT action, detail FROM audit_log WHERE entity_id = ?").get('res-1') as any
    expect(audit.action).toBe('expire')
    expect(JSON.parse(audit.detail).motivo).toBe('expire')
    expect(kvGet(db, 'canceladas')).toContain('HM1')
  })

  it('no expira antes de la ventana', () => {
    insertaReserva('res-1', 'HM1', { ...futuro, uid: 'res-1@airbnb.com' })
    db.prepare("UPDATE reservations SET airbnb_status = 'pending', missing_since = ? WHERE id = ?")
      .run(Date.now() - 3600 * 1000, 'res-1')
    expect(expirarSolicitudes(db)).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) n FROM reservations WHERE id = ?').get('res-1')).toEqual({ n: 1 })
  })

  it('nunca expira una reserva confirmada, aunque lleve días ausente', () => {
    insertaReserva('res-1', 'HM1', { ...futuro, uid: 'res-1@airbnb.com' })
    db.prepare("UPDATE reservations SET airbnb_status = 'complete', missing_since = ? WHERE id = ?")
      .run(Date.now() - 300 * 3600 * 1000, 'res-1')
    expect(expirarSolicitudes(db)).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) n FROM reservations WHERE id = ?').get('res-1')).toEqual({ n: 1 })
  })

  it('reconoce los estados de solicitud y no los confunde con una cancelación', () => {
    expect(esSolicitudPendiente('pending', 'Reserva solicitada')).toBe(true)
    expect(esSolicitudPendiente('REQUESTED', null)).toBe(true)
    expect(esSolicitudPendiente('', 'Solicitud pendiente')).toBe(true)
    expect(esSolicitudPendiente('complete', 'Reserva confirmada')).toBe(false)
    expect(esSolicitudPendiente('cancelled', 'Cancelada')).toBe(false)
  })
})

describe('estado de la sesión para la UI (#303)', () => {
  it('sin fichero de estado no hay caída: sesion null y motivo sin_estado', () => {
    const st = airbnbStatus(db)
    expect(st.sesion).toBeNull()
    expect(st.configurada).toBe(false)
    expect(st.motivo).toBe('sin_estado')
  })

  it('con fichero devuelve la sesión y su motivo traducibible', () => {
    escribeSesion(false, 'HTTP 401: sesion muerta o bloqueo')
    const st = airbnbStatus(db)
    expect(st.configurada).toBe(true)
    expect(st.sesion?.viva).toBe(false)
    expect(st.motivo).toBe('http')
  })

  it('clasifica los detalles que escribe el scraper', () => {
    expect(motivoSesion('ok')).toBe('ok')
    expect(motivoSesion('sin reservas extraidas')).toBe('vacio')
    expect(motivoSesion('2 pagina(s) con error')).toBe('errores')
    expect(motivoSesion(null)).toBe('otro')
    expect(motivoSesion('algo raro')).toBe('otro')
  })
})
