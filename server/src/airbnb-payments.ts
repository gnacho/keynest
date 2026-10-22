// airbnb-payments.js — transferencias individuales de Airbnb (#298).
//
// Las estancias de más de un mes no se cobran en un único pago: Airbnb cobra al
// huésped en plazos y abona al anfitrión tras cada uno. El aviso de "transacción
// abonada" existente (alerts.js, checkTransacciones) usa reservations.amount,
// que es el TOTAL de la estancia, así que los plazos posteriores no se ven y el
// importe no coincide con el que llega al banco.
//
// Fuente: el scraper local vuelca la operación FetchProductTransactions (página
// "Cobros pendientes" del panel de anfitrión) en <dir>/airbnb_pagos.json. Esa
// vista incluye tanto los plazos PROGRAMADOS como los enviados hoy, así que el
// aviso puede salir el MISMO DÍA en que Airbnb emite el pago (SENT_TODAY).
//
// OJO: un mismo productConfirmationCode aparece varias veces (una por plazo),
// así que external_ref NO puede ser solo el código ni el token de producto:
// se compone con fecha de emisión + importe + código.
import fs from 'node:fs'
import path from 'node:path'
import { kvGet, kvSet } from './db.js'
import type { DB } from './db.js'
import { airbnbDataDir, mapaListings } from './airbnb-sync.js'

export interface PagoAirbnb {
  confirmationCode: string
  listingId: string | null
  emittedOn: string
  amount: number
  currency: string
  status: string
  externalRef: string
}

/** Estados en los que Airbnb ya ha emitido el pago (o lo emite hoy). */
const ESTADOS_EMITIDOS = new Set(['SENT_TODAY', 'SENT', 'PAID', 'DEPOSITED', 'COMPLETED'])

const FICHERO = 'airbnb_pagos.json'

/** Importes es-ES: "2.051,86 €" -> 2051.86. También admite "2051.86". */
export function parseImporteES(texto: string | null | undefined): number | null {
  if (texto == null) return null
  const limpio = String(texto).replace(/[^\d.,-]/g, '').trim()
  if (!limpio) return null
  const normalizado = limpio.includes(',') ? limpio.replace(/\./g, '').replace(',', '.') : limpio
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/** Convierte micros ("2051860000") a euros cuando no hay texto formateado. */
export function microsAEuros(micros: string | number | null | undefined): number | null {
  if (micros == null || micros === '') return null
  const n = Number(micros)
  if (!Number.isFinite(n)) return null
  return Math.round(n) / 1_000_000
}

function fechaISO(valor: any): string {
  if (!valor) return ''
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

/**
 * Clave idempotente de un plazo. Un mismo código de reserva tiene varios plazos,
 * y dentro de una misma emisión puede haber varios conceptos (alojamiento +
 * limpieza), así que se combina fecha de emisión, importe y código.
 */
export function refPlazo(fecha: string, amount: number, code: string): string {
  return `${fecha}|${amount.toFixed(2)}|${code}`
}

/** ¿Este estado significa que Airbnb ya ha emitido el pago? */
export function esEmitido(status: string | null | undefined): boolean {
  return ESTADOS_EMITIDOS.has(String(status || '').toUpperCase())
}

/**
 * Normaliza el volcado del scraper a una lista plana de plazos.
 * Tolerante a la forma: acepta la respuesta GraphQL completa, el objeto
 * fetchProductTransactions ya extraído o una lista de productTransactions.
 */
export function normalizarPagos(crudo: any): PagoAirbnb[] {
  let filas: any[] = []
  if (Array.isArray(crudo)) {
    filas = crudo
  } else if (crudo && typeof crudo === 'object') {
    filas =
      crudo?.data?.payout_transaction_history?.fetchProductTransactions?.productTransactions ??
      crudo?.fetchProductTransactions?.productTransactions ??
      crudo?.productTransactions ??
      []
  }
  const salida: PagoAirbnb[] = []
  const vistos = new Set<string>()
  for (const pr of filas) {
    const code = pr?.productConfirmationCode
    if (!code) continue
    const fmt = pr?.currencyAmount?.nativeCurrencyAmountFormatted
    const amount = parseImporteES(fmt?.amountFormatted) ?? microsAEuros(fmt?.amountMicros)
    if (amount == null) continue
    // Fecha de emisión: readyForReleaseAt es cuando Airbnb libera el pago; si no
    // está, se usa la de depósito estimada.
    const emittedOn =
      fechaISO(pr?.readyForReleaseAtTimestamp) || fechaISO(pr?.estimatedDepositTimestamp) || fechaISO(pr?.startDate)
    if (!emittedOn) continue
    const ref = refPlazo(emittedOn, amount, String(code))
    if (vistos.has(ref)) continue
    vistos.add(ref)
    salida.push({
      confirmationCode: String(code),
      listingId: pr?.hostingId ? String(pr.hostingId) : null,
      emittedOn,
      amount,
      currency: String(fmt?.currency || 'EUR'),
      status: String(pr?.transactionStatus?.status || ''),
      externalRef: ref,
    })
  }
  return salida
}

export function rutaPagos(): string {
  return path.join(airbnbDataDir(), FICHERO)
}

/** Lee y normaliza el volcado del scraper. Devuelve [] si no existe o está roto. */
export function leerPagosDeDisco(ruta = rutaPagos()): PagoAirbnb[] {
  try {
    return normalizarPagos(JSON.parse(fs.readFileSync(ruta, 'utf-8')))
  } catch {
    return []
  }
}

/**
 * Inserta los plazos nuevos y devuelve los registrados. Idempotente por
 * external_ref. El inmueble se resuelve por confirmation_code y, si la reserva
 * aún no existe, por listing_id (emparejamiento por ID, nunca por nombre).
 */
export function ingerirPagos(db: DB, pagos: PagoAirbnb[], listings?: Map<string, string>): PagoAirbnb[] {
  if (!pagos.length) return []
  const mapa = listings ?? mapaListings(db)
  const buscarReserva = db.prepare('SELECT id, property_id FROM reservations WHERE confirmation_code = ?')
  // Reserva de respaldo por inmueble cuando el código aún no está sincronizado.
  const buscarPorInmueble = db.prepare(
    'SELECT id FROM reservations WHERE property_id = ? ORDER BY checkin DESC LIMIT 1'
  )
  const existe = db.prepare('SELECT 1 FROM reservation_payments WHERE external_ref = ?')
  const insertar = db.prepare(
    `INSERT INTO reservation_payments
       (id, reservation_id, confirmation_code, paid_on, amount, currency, status, external_ref, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const nuevos: PagoAirbnb[] = []
  const tx = db.transaction(() => {
    for (const p of pagos) {
      if (existe.get(p.externalRef)) continue
      let res = buscarReserva.get(p.confirmationCode) as { id: string } | undefined
      if (!res && p.listingId) {
        const propId = mapa.get(p.listingId)
        if (propId) res = buscarPorInmueble.get(propId) as { id: string } | undefined
      }
      const id = `pay_${p.externalRef.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}`
      insertar.run(
        id,
        res?.id ?? null,
        p.confirmationCode,
        p.emittedOn,
        p.amount,
        p.currency,
        p.status,
        p.externalRef,
        Date.now()
      )
      nuevos.push(p)
    }
  })
  tx()
  return nuevos
}

/** Total abonado (y número de plazos) de una reserva. */
export function pagadoDeReserva(
  db: DB,
  confirmationCode: string
): { total: number; plazos: number; ultimo: string | null } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS plazos, MAX(paid_on) AS ultimo
       FROM reservation_payments WHERE confirmation_code = ?`
    )
    .get(confirmationCode) as { total: number; plazos: number; ultimo: string | null }
}

/**
 * Avisa de cada plazo EMITIDO hoy al dueño del inmueble.
 *
 * El aviso sale el mismo día en que Airbnb emite el pago (estado SENT_TODAY),
 * no cuando el dinero se confirma en el banco. Los plazos meramente programados
 * (SCHEDULED) se registran pero no generan aviso. Dedupe por external_ref.
 */
export function avisarPagosNuevos(
  db: DB,
  notifyUsersFn: (db: DB, users: string[], tipo: string, datos: Record<string, any>, opciones: any) => void,
  pagos: PagoAirbnb[],
  hoy = new Date().toISOString().slice(0, 10)
): number {
  let avisados = 0
  const buscar = db.prepare(
    `SELECT r.id, r.summary, r.guest_name, p.name AS propiedad, p.owner_id
     FROM reservations r JOIN properties p ON p.id = r.property_id
     WHERE r.confirmation_code = ?`
  )
  for (const p of pagos) {
    if (!esEmitido(p.status)) continue // solo cuando Airbnb lo ha emitido
    const key = `push_pay_${p.externalRef}`
    if (kvGet(db, key)) continue
    const f = buscar.get(p.confirmationCode) as
      | { id: string; summary: string; guest_name: string; propiedad: string; owner_id: string | null }
      | undefined
    if (!f || !f.owner_id) continue
    notifyUsersFn(
      db,
      [f.owner_id],
      'transaccion',
      {
        propiedad: f.propiedad,
        resumen: f.summary,
        importe: p.amount,
        fecha: p.emittedOn,
        huesped: f.guest_name || null,
      },
      { severity: 'normal', url: `/reservas?reserva=${f.id}` }
    )
    kvSet(db, key, '1')
    avisados++
  }
  return avisados
}

/** Ingesta + aviso desde el volcado del scraper. Devuelve cuántos se avisaron. */
export function sincronizarPagos(db: DB, notifyUsersFn: Parameters<typeof avisarPagosNuevos>[1]): number {
  const pagos = leerPagosDeDisco()
  if (!pagos.length) return 0
  const nuevos = ingerirPagos(db, pagos)
  if (!nuevos.length) return 0
  return avisarPagosNuevos(db, notifyUsersFn, nuevos)
}
