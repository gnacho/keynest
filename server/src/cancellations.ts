// cancellations.ts - avisos de cancelaciones recientes (#340).
//
// Las reservas canceladas se borran de `reservations` (ver cancel-booking.ts),
// asi que la unica traza que queda es la fila de `audit_log` con action
// 'cancel'. Este modulo la lee para que la app pueda avisar en pantalla de que
// unas fechas concretas vuelven a estar libres.
//
// La ventana y el limite son fijos: el aviso es un recordatorio reciente, no
// un historico. Las filas sin JSON valido se ignoran en lugar de romper la
// lista entera.
import type { DB } from './db.js'

export const CANCELLATION_WINDOW_DAYS = 7
export const CANCELLATION_LIMIT = 20
const MAX_LIMIT = 100

export interface CancellationNotice {
  /** id de la fila de audit_log: identificador estable para desduplicar. */
  id: number
  propertyId: string
  propertyName: string
  summary: string
  guestName: string
  checkin: string
  checkout: string
  amount: number
  /** Instante de la cancelacion (epoch ms). */
  cancelledAt: number
}

export interface RecentCancellationsOptions {
  windowDays?: number
  limit?: number
  now?: number
}

interface AuditRow {
  id: number
  detail: string | null
  at: number
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

function numero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0
}

/**
 * Cancelaciones de los ultimos `windowDays` dias, de la mas reciente a la mas
 * antigua. Los campos de propiedad solo existen en las filas escritas desde
 * #340 en adelante: las anteriores se devuelven con propiedad vacia.
 */
export function recentCancellations(db: DB, options: RecentCancellationsOptions = {}): CancellationNotice[] {
  const windowDays = options.windowDays && options.windowDays > 0 ? options.windowDays : CANCELLATION_WINDOW_DAYS
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? CANCELLATION_LIMIT), 1), MAX_LIMIT)
  const now = options.now ?? Date.now()
  const desde = now - windowDays * 24 * 3600 * 1000

  const rows = db.prepare(
    `SELECT id, detail, at FROM audit_log
     WHERE action = 'cancel' AND entity = 'reservation' AND at >= ?
     ORDER BY at DESC, id DESC
     LIMIT ?`
  ).all(desde, limit) as AuditRow[]

  // El nombre puede haber cambiado desde la cancelacion: se prefiere el actual.
  const propiedades = new Map<string, string>()
  for (const p of db.prepare('SELECT id, name FROM properties').all() as Array<{ id: string; name: string }>) {
    propiedades.set(p.id, p.name)
  }

  const avisos: CancellationNotice[] = []
  for (const row of rows) {
    let detail: Record<string, unknown>
    try {
      const parsed = JSON.parse(row.detail || '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      detail = parsed as Record<string, unknown>
    } catch {
      continue
    }
    const propertyId = texto(detail.property_id)
    avisos.push({
      id: row.id,
      propertyId,
      propertyName: propiedades.get(propertyId) ?? texto(detail.property_name),
      summary: texto(detail.summary),
      guestName: texto(detail.guest_name),
      checkin: texto(detail.checkin),
      checkout: texto(detail.checkout),
      amount: numero(detail.amount),
      cancelledAt: row.at,
    })
  }
  return avisos
}
