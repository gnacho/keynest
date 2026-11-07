import crypto from 'node:crypto'
import { fetchIcs, icsToReservations, parseIcs } from './ical.js'
import { kvGet, kvSet } from './db.js'
import type { DB } from './db.js'
import type { IcsReservation } from './ical.js'
import { hoyLocal } from './alerts.js'
import type { ReservaAcortadaItem } from './alerts.js'
import { cancelBooking, estaCancelada, tombstonesVigentes } from './cancel-booking.js'
import type { CancelledBooking } from './cancel-booking.js'

/**
 * Sincroniza las reservas de todos los inmuebles con ical_url.
 * Estrategia: reemplazo completo por inmueble (los uid que ya no vienen se borran).
 * Devuelve stats por inmueble para mostrar en la UI.
 * onNews(nombreInmueble, items): reservas con uid NUEVO (no estaban en BD).
 * onCancelled(nombreInmueble, items): reservas que ya no vienen del feed iCal
 *   y que estaban confirmadas (cancelación). La fila y sus datos dependientes
 *   se borran ANTES de llamar; aquí solo se avisa (#334).
 * NUNCA se llama en el primer sync OK del inmueble (import inicial = todo
 * "nuevo" → anti-spam; se detecta por el kv sync_<id> con ok previo).
 */
export async function syncAll(
  db: DB,
  { onNews, onCancelled, onShortened, fetchIcs: fetchFeed = fetchIcs } = {} as {
    onNews?: (name: string, items: IcsReservation[]) => void
    onCancelled?: (name: string, items: CancelledBooking[]) => void
    onShortened?: (name: string, items: ReservaAcortadaItem[]) => void
    fetchIcs?: typeof fetchIcs
  }
) {
  const props = db.prepare("SELECT id, name, ical_url FROM properties WHERE ical_url != ''").all() as Array<{ id: string; name: string; ical_url: string }>
  const results: Array<Record<string, unknown>> = []
  for (const p of props) {
    const key = `sync_${p.id}`
    let prevOk = false
    try {
      prevOk = JSON.parse(kvGet(db, key) || '{}').ok === true
    } catch { /* noop */ }
    try {
      const text = await fetchFeed(p.ical_url)
      const events = parseIcs(text)
      // Un feed desfasado tras una cancelación no debe resucitar la reserva.
      const tombstones = tombstonesVigentes(db)
      const items = icsToReservations(events).filter((i) => !estaCancelada(tombstones, i.uid, i.confirmation_code ?? ''))
      const now = Date.now()
      const seen = new Set(items.map((i) => i.uid))
      const prevUids = new Set((db.prepare('SELECT uid FROM reservations WHERE property_id = ?').all(p.id) as Array<{ uid: string }>).map((r) => r.uid))

      const upsert = db.prepare(`
        INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, phone_last4, created_at, airbnb_sync_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        ON CONFLICT(uid) DO UPDATE SET
          property_id = reservations.property_id,
          checkin = excluded.checkin,
          checkout = excluded.checkout,
          summary = excluded.summary,
          confirmation_code = excluded.confirmation_code,
          phone_last4 = excluded.phone_last4,
          airbnb_sync_state = CASE WHEN reservations.airbnb_sync_state = '' THEN 'pending' ELSE reservations.airbnb_sync_state END
      `)
      const findExisting = db.prepare(
        `SELECT id, property_id, checkin, checkout, summary, confirmation_code, guest_name, amount
         FROM reservations WHERE uid = ?`
      )
      const canceladas: CancelledBooking[] = []
      const acortadas: ReservaAcortadaItem[] = []
      const tx = db.transaction(() => {
        for (const i of items) {
          const prev = findExisting.get(i.uid) as {
            id: string
            property_id: string
            checkin: string
            checkout: string
            summary: string
            confirmation_code: string
            guest_name: string | null
            amount: number | null
          } | undefined
          if (prev && prev.property_id === p.id && i.checkout < prev.checkout) {
            acortadas.push({
              reservationId: prev.id,
              propertyName: p.name,
              summary: i.summary || prev.summary,
              checkin: i.checkin,
              previousCheckout: prev.checkout,
              checkout: i.checkout,
              confirmationCode: i.confirmation_code || prev.confirmation_code,
              guestName: prev.guest_name || '',
              amount: prev.amount || 0,
            })
          }
          upsert.run(crypto.randomUUID(), p.id, i.uid, i.checkin, i.checkout, i.summary, i.confirmation_code, i.phone_last4, now)
        }
        // Solo borra uds ORIGEN iCal (@airbnb.com): las reservas importadas
        // del CSV (uid csv-…) deben sobrevivir a cada sincronización.
        // 🔥 Las reservas FINALIZADAS (checkout < hoy) se conservan SIEMPRE:
        // el feed de Airbnb solo lista actuales/futuras, así que una estancia
        // que termina desaparece del iCal y el reemplazo completo la borraría
        // (perdiendo histórico y las cuentas de Rentabilidad). Solo se borran
        // las reservas pendientes/futuras que ya no vienen (cancelaciones).
        // #334: la cancelación se borra en cascada (pagos + limpiezas +
        // tombstone + audit) y se avisa por push a continuación.
        const existing = db.prepare(
          "SELECT id, uid FROM reservations WHERE property_id = ? AND uid LIKE '%@airbnb.com' AND checkout >= ?"
        ).all(p.id, hoyLocal()) as Array<{ id: string; uid: string }>
        for (const row of existing) {
          if (seen.has(row.uid)) continue
          const cancelada = cancelBooking(db, row.id)
          if (cancelada) canceladas.push(cancelada)
        }
      })
      tx()
      if (onNews && prevOk) {
        const news = items.filter((i) => !prevUids.has(i.uid))
        if (news.length > 0) onNews(p.name, news)
      }
      // Solo se avisa de cancelaciones que llegaron a estar confirmadas. Las
      // solicitudes que nunca se confirmaron se limpian igual, pero su aviso
      // corresponde a #331 (rechazo/caducidad), no a una cancelación.
      if (onCancelled) {
        const avisables = canceladas.filter((c) => c.matched)
        if (avisables.length > 0) onCancelled(p.name, avisables)
      }
      if (onShortened && acortadas.length > 0) onShortened(p.name, acortadas)
      const status = { ok: true, at: now, count: items.length, cancelled: canceladas.length }
      kvSet(db, key, JSON.stringify(status))
      results.push({ propertyId: p.id, name: p.name, ...status })
      console.log(`[sync] ${p.name}: ${items.length} reservas, ${canceladas.length} canceladas`)
    } catch (err) {
      const status = { ok: false, at: Date.now(), error: (err as Error).message }
      kvSet(db, key, JSON.stringify(status))
      results.push({ propertyId: p.id, name: p.name, ...status })
      console.error(`[sync] ${p.name}: ERROR ${(err as Error).message}`)
    }
  }
  return results
}

export function syncStatus(db: DB): Record<string, unknown> {
  const rows = db.prepare("SELECT key, value FROM kv WHERE key LIKE 'sync_%'").all() as Array<{ key: string; value: string }>
  const out: Record<string, unknown> = {}
  for (const r of rows) {
    try { out[r.key.slice(5)] = JSON.parse(r.value) } catch { /* noop */ }
  }
  return out
}
