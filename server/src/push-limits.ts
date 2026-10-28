// Límites de recursos de Web Push (#316): cuota de dispositivos por usuario,
// rate limit de suscripción y concurrencia acotada en el envío. Sin esto, un
// usuario autenticado puede registrar endpoints bajo su control y mantener
// conexiones o memoria crecientes.
import type { DB } from './db.js'

export const MAX_SUBSCRIPTIONS_PER_USER = 10
export const MAX_CONCURRENT_PUSH = 4
export const MAX_SUBSCRIBE_PER_MINUTE = 30
const WINDOW_MS = 60 * 1000

export function subscriptionCount(db: DB, userId: string): number {
  const row = db.prepare('SELECT COUNT(*) count FROM push_subscriptions WHERE user_id = ?').get(userId) as { count: number }
  return row.count
}

/* Re-suscribir un endpoint ya registrado no consume cuota: el navegador
   reenvía la misma suscripción al renovar claves. */
export function subscriptionQuotaAllows(db: DB, userId: string, endpoint: string): boolean {
  const existing = db.prepare('SELECT 1 present FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .get(userId, endpoint)
  if (existing) return true
  return subscriptionCount(db, userId) < MAX_SUBSCRIPTIONS_PER_USER
}

/* Ventana deslizante de un minuto por usuario, en la misma tabla que el resto
   de rate limits. Devuelve true cuando la petición debe rechazarse. */
export function subscribeRateLimited(db: DB, userId: string, now = Date.now()): boolean {
  const key = `push:subscribe:${userId}`
  const row = db.prepare('SELECT count, window_end FROM rate_limits WHERE key = ?')
    .get(key) as { count: number; window_end: number } | undefined
  if (!row || row.window_end < now) {
    db.prepare('INSERT INTO rate_limits (key, count, window_end) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_end = excluded.window_end')
      .run(key, now + WINDOW_MS)
    return false
  }
  if (row.count >= MAX_SUBSCRIBE_PER_MINUTE) return true
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key)
  return false
}

/* Ejecuta fn sobre items con un máximo de promesas en vuelo y devuelve un
   resultado settled por elemento, en el mismo orden que la entrada. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  const size = Math.max(1, Math.min(limit, items.length))
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = next++
      if (index >= items.length) return
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index]!) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: size }, () => worker()))
  return results
}
