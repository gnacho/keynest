import crypto from 'node:crypto'
import { decryptSecret, encryptSecret, kvGet, kvSet } from './db.js'

/** Config Tedee guardada en kv de la BD de producción. */
export function tedeeConfig(db) {
  const stored = kvGet(db, 'tedee_token') || ''
  let token = decryptSecret(db, stored)
  // Migración de token en claro → cifrado transparente
  if (stored && !stored.startsWith('gcm:')) {
    kvSet(db, 'tedee_token', encryptSecret(db, token))
  }
  return {
    url: kvGet(db, 'tedee_url') || '',
    token,
  }
}

export function saveTedeeConfig(db, url, token) {
  kvSet(db, 'tedee_url', url.replace(/\/+$/, ''))
  if (token) kvSet(db, 'tedee_token', encryptSecret(db, token))
}

/** Header api_token: hex(sha256(token+ts)) + ts — verificado contra bridge real 31-Jul-2026. */
function authHeader(token) {
  const ts = Date.now().toString()
  const hash = crypto.createHash('sha256').update(token + ts).digest('hex')
  return hash + ts
}

export async function tedeeFetch(db, path) {
  const { url, token } = tedeeConfig(db)
  if (!url || !token) throw new Error('not-configured')
  const res = await fetch(`${url}${path}`, {
    headers: { api_token: authHeader(token) },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`http-${res.status}`)
  return res.json()
}

/** Lista de cerraduras del bridge: [{id, name, battery, online, rssi, state, serial}] */
export async function tedeeLocks(db) {
  const raw = await tedeeFetch(db, '/v1.0/lock')
  if (!Array.isArray(raw)) return []
  return raw.map((l) => ({
    id: l.id,
    name: l.name,
    battery: l.batteryLevel ?? 0,
    online: Boolean(l.isConnected),
    rssi: l.rssi ?? null,
    state: l.state ?? null,
    jammed: Boolean(l.jammed),
    serial: l.serialNumber ?? '',
  }))
}
