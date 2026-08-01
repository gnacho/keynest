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

/** ¿API cloud pública (api.tedee.com)? Esquema PAK: Authorization: PersonalKey <PAK>.
 *  Si no, es el bridge LOCAL (api_token: sha256(token+ts)+ts). */
function isCloudUrl(url) {
  try {
    return /(^|\.)tedee\.com$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

export async function tedeeFetch(db, path, cloudPath) {
  const { url, token } = tedeeConfig(db)
  if (!url || !token) throw new Error('not-configured')
  const cloud = isCloudUrl(url)
  const res = await fetch(`${url}${cloud ? cloudPath : path}`, {
    headers: cloud ? { Authorization: `PersonalKey ${token}`, accept: 'application/json' } : { api_token: authHeader(token) },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`http-${res.status}`)
  return res.json()
}

/** Lista de cerraduras: [{id, name, battery, online, rssi, state, serial}]
 *  Bridge: GET /v1.0/lock. Cloud: GET /api/v37/my/lock (PAK). */
export async function tedeeLocks(db) {
  const cloud = isCloudUrl(tedeeConfig(db).url)
  const raw = await tedeeFetch(db, '/v1.0/lock', '/api/v37/my/lock')
  if (cloud) {
    const list = Array.isArray(raw?.result) ? raw.result : []
    return list.map((l) => ({
      id: l.id,
      name: l.name,
      battery: l.deviceState?.batteryLevel ?? 0,
      online: Boolean(l.isConnected),
      rssi: null, // la cloud no expone rssi del BLE
      state: l.deviceState?.state ?? null,
      jammed: false,
      serial: l.serialNumber ?? '',
    }))
  }
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
