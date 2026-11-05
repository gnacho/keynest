// cancel-booking.ts — borrado en cascada de reservas canceladas (#334).
//
// Una reserva confirmada que se cancela en Airbnb desaparece del feed iCal y
// del snapshot del scraper. Antes se borraba la fila a secas: sin push, sin
// traza y dejando pagos y limpiezas apuntando a una reserva inexistente.
// Este módulo centraliza el borrado para las DOS vías de detección (iCal y
// scraper), deja un tombstone en kv para que el feed no la resucite y anota la
// cancelación en audit_log.
//
// Límites deliberados:
// - Solo reservas con checkout >= hoy: el histórico nunca se toca.
// - Los ficheros de fotos de las limpiezas borradas NO se eliminan del disco.
import { kvGet, kvSet } from './db.js'
import type { DB } from './db.js'
import { hoyLocal } from './alerts.js'

const CLAVE_TOMBSTONES = 'canceladas'
const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000
const MAX_TOMBSTONES = 500

export interface Tombstone {
  uid: string
  code: string
  at: number
}

export interface CancelledBooking {
  reservationId: string
  propertyId: string
  propertyName: string
  summary: string
  checkin: string
  checkout: string
  confirmationCode: string
  guestName: string
  amount: number
  /** La reserva llegó a cruzarse con el scraper (llegó a estar confirmada). */
  matched: boolean
}

interface ReservaFila {
  id: string
  property_id: string
  uid: string
  checkin: string
  checkout: string
  summary: string
  confirmation_code: string
  guest_name: string | null
  amount: number | null
  airbnb_status: string | null
  airbnb_sync_state: string | null
  property_name: string | null
}

/** Estados del scraper que implican cancelación CONFIRMADA.
 *  Ojo: NOT_REQUESTED, REQUESTED, PENDING y PENDING_REVIEW son solicitudes
 *  pendientes, no cancelaciones (#331). */
export function esCancelacionConfirmada(status: unknown, cancellationStatus: unknown): boolean {
  const s = String(status ?? '').trim().toLowerCase()
  const c = String(cancellationStatus ?? '').trim().toUpperCase()
  return s === 'cancelled' || s === 'canceled' || c.startsWith('CANCELLED')
}

/** Tombstones vigentes (uid + confirmation_code de reservas ya canceladas). */
export function tombstonesVigentes(db: DB, ahora = Date.now()): Tombstone[] {
  let lista: Tombstone[] = []
  try {
    const raw = JSON.parse(kvGet(db, CLAVE_TOMBSTONES) || '[]')
    if (Array.isArray(raw)) lista = raw.filter((t) => t && typeof t.uid === 'string' && t.at > ahora - TOMBSTONE_TTL_MS)
  } catch { /* kv corrupto: se reconstruye al siguiente aviso */ }
  return lista
}

/** ¿Esta reserva ya fue cancelada? Evita que un feed iCal desfasado la recree. */
export function estaCancelada(tombstones: Tombstone[], uid: string, code: string): boolean {
  return tombstones.some((t) => t.uid === uid || (!!code && t.code === code))
}

function anotarTombstone(db: DB, fila: ReservaFila, ahora: number): void {
  const lista = tombstonesVigentes(db, ahora)
    .filter((t) => t.uid !== fila.uid && (!fila.confirmation_code || t.code !== fila.confirmation_code))
  lista.push({ uid: fila.uid, code: fila.confirmation_code || '', at: ahora })
  kvSet(db, CLAVE_TOMBSTONES, JSON.stringify(lista.slice(-MAX_TOMBSTONES)))
}

/** Motivo del borrado: cancelación real o solicitud que nunca se confirmó (#331). */
export type MotivoCancelacion = 'cancel' | 'expire'

/**
 * Borra la reserva y sus datos dependientes. Devuelve los datos para el push,
 * o null si la reserva no existe o es histórica (checkout anterior a hoy).
 * El motivo solo cambia la traza en audit_log: la expiración de una solicitud
 * no lleva push porque nunca hubo reserva confirmada que avisar.
 */
export function cancelBooking(
  db: DB,
  reservationId: string,
  motivo: MotivoCancelacion = 'cancel'
): CancelledBooking | null {
  const fila = db.prepare(
    `SELECT r.id, r.property_id, r.uid, r.checkin, r.checkout, r.summary,
            r.confirmation_code, r.guest_name, r.amount, r.airbnb_status,
            r.airbnb_sync_state, p.name AS property_name
     FROM reservations r LEFT JOIN properties p ON p.id = r.property_id
     WHERE r.id = ?`
  ).get(reservationId) as ReservaFila | undefined
  if (!fila || fila.checkout < hoyLocal()) return null

  const ahora = Date.now()
  const detalle = JSON.stringify({
    uid: fila.uid,
    confirmation_code: fila.confirmation_code,
    checkin: fila.checkin,
    checkout: fila.checkout,
    summary: fila.summary,
    guest_name: fila.guest_name,
    amount: fila.amount,
    motivo,
  })

  const tx = db.transaction(() => {
    anotarTombstone(db, fila, ahora)
    // Los pagos pueden tener el reservation_id obsoleto (así quedó el huérfano
    // de HM5ZWXMCJK): se borra por id Y por código de confirmación.
    db.prepare(
      `DELETE FROM reservation_payments
       WHERE reservation_id = ? OR (confirmation_code <> '' AND confirmation_code = ?)`
    ).run(fila.id, fila.confirmation_code || '')
    db.prepare('DELETE FROM cleanings WHERE reservation_id = ?').run(fila.id)
    db.prepare('DELETE FROM reservations WHERE id = ?').run(fila.id)
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail, at)
       VALUES (NULL, ?, 'reservation', ?, ?, ?)`
    ).run(motivo, fila.id, detalle, ahora)
  })
  tx()

  return {
    reservationId: fila.id,
    propertyId: fila.property_id,
    propertyName: fila.property_name || '',
    summary: fila.summary || '',
    checkin: fila.checkin,
    checkout: fila.checkout,
    confirmationCode: fila.confirmation_code || '',
    guestName: fila.guest_name || '',
    amount: fila.amount ?? 0,
    matched: fila.airbnb_sync_state === 'matched' || !!fila.airbnb_status,
  }
}
