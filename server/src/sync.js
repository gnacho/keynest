import crypto from 'node:crypto'
import { fetchIcs, icsToReservations, parseIcs } from './ical.js'
import { kvGet, kvSet } from './db.js'
import { hoyLocal } from './alerts.js'

/**
 * Sincroniza las reservas de todos los inmuebles con ical_url.
 * Estrategia: reemplazo completo por inmueble (los uid que ya no vienen se borran).
 * Devuelve stats por inmueble para mostrar en la UI.
 * onNews(nombreInmueble, items): reservas con uid NUEVO (no estaban en BD).
 * NUNCA se llama en el primer sync OK del inmueble (import inicial = todo
 * "nuevo" → anti-spam; se detecta por el kv sync_<id> con ok previo).
 */
export async function syncAll(db, { onNews } = {}) {
  const props = db.prepare("SELECT id, name, ical_url FROM properties WHERE ical_url != ''").all()
  const results = []
  for (const p of props) {
    const key = `sync_${p.id}`
    let prevOk = false
    try {
      prevOk = JSON.parse(kvGet(db, key) || '{}').ok === true
    } catch { /* noop */ }
    try {
      const text = await fetchIcs(p.ical_url)
      const events = parseIcs(text)
      const items = icsToReservations(events)
      const now = Date.now()
      const seen = new Set(items.map((i) => i.uid))
      const prevUids = new Set(db.prepare('SELECT uid FROM reservations WHERE property_id = ?').all(p.id).map((r) => r.uid))

      const upsert = db.prepare(`
        INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, phone_last4, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uid) DO UPDATE SET
          property_id = reservations.property_id,
          checkin = excluded.checkin,
          checkout = excluded.checkout,
          summary = excluded.summary,
          confirmation_code = excluded.confirmation_code,
          phone_last4 = excluded.phone_last4
      `)
      const tx = db.transaction(() => {
        for (const i of items) {
          upsert.run(crypto.randomUUID(), p.id, i.uid, i.checkin, i.checkout, i.summary, i.confirmation_code, i.phone_last4, now)
        }
        // Solo borra uds ORIGEN iCal (@airbnb.com): las reservas importadas
        // del CSV (uid csv-…) deben sobrevivir a cada sincronización.
        // 🔥 Las reservas FINALIZADAS (checkout < hoy) se conservan SIEMPRE:
        // el feed de Airbnb solo lista actuales/futuras, así que una estancia
        // que termina desaparece del iCal y el reemplazo completo la borraría
        // (perdiendo histórico y las cuentas de Rentabilidad). Solo se borran
        // las reservas pendientes/futuras que ya no vienen (cancelaciones).
        const existing = db.prepare("SELECT uid FROM reservations WHERE property_id = ? AND uid LIKE '%@airbnb.com' AND checkout >= ?").all(p.id, hoyLocal())
        const del = db.prepare('DELETE FROM reservations WHERE uid = ?')
        for (const row of existing) {
          if (!seen.has(row.uid)) del.run(row.uid)
        }
      })
      tx()
      if (onNews && prevOk) {
        const news = items.filter((i) => !prevUids.has(i.uid))
        if (news.length > 0) onNews(p.name, news)
      }
      const status = { ok: true, at: now, count: items.length }
      kvSet(db, key, JSON.stringify(status))
      results.push({ propertyId: p.id, name: p.name, ...status })
      console.log(`[sync] ${p.name}: ${items.length} reservas`)
    } catch (err) {
      const status = { ok: false, at: Date.now(), error: err.message }
      kvSet(db, key, JSON.stringify(status))
      results.push({ propertyId: p.id, name: p.name, ...status })
      console.error(`[sync] ${p.name}: ERROR ${err.message}`)
    }
  }
  return results
}

export function syncStatus(db) {
  const rows = db.prepare("SELECT key, value FROM kv WHERE key LIKE 'sync_%'").all()
  const out = {}
  for (const r of rows) {
    try { out[r.key.slice(5)] = JSON.parse(r.value) } catch { /* noop */ }
  }
  return out
}
