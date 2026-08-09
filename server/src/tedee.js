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

/** Lista de cerraduras: [{id, name, battery, online, rssi, state, serial, propertyId}]
 *  Bridge: GET /v1.0/lock. Cloud: GET /api/v37/my/lock (PAK).
 *  propertyId se cruza con properties.tedee_lock_id (si hay match). */
export async function tedeeLocks(db) {
  const cloud = isCloudUrl(tedeeConfig(db).url)
  const raw = await tedeeFetch(db, '/v1.0/lock', '/api/v37/my/lock')
  // lock_id Tedee → property_id de Keynest (para asociar accesos a inmuebles)
  const propByLock = new Map()
  for (const p of db.prepare('SELECT id, tedee_lock_id FROM properties WHERE tedee_lock_id IS NOT NULL').all()) {
    propByLock.set(Number(p.tedee_lock_id), p.id)
  }
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
      propertyId: propByLock.get(Number(l.id)) ?? '',
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
    propertyId: propByLock.get(Number(l.id)) ?? '',
  }))
}

/** Eventos de deviceactivity que suponen un ACCESO real (abrir/cerrar por persona).
 *  Unlock/pull por PIN, huella o app → entrada; lock por PIN/teclado → salida;
 *  acciones remotas desde la app → remota. Los eventos de sistema (batería,
 *  calibración, jammed…) se ignoran. Fuente: docs oficiales event-type. */
const ACCESS_EVENT_TYPE = {
  32: 'remota', 33: 'remota', 34: 'remota', 35: 'remota', // lock/unlock botón
  51: 'remota', 52: 'remota', 53: 'remota', // pull spring
  61: 'entrada', 63: 'entrada', 64: 'entrada', 76: 'entrada', // pin unlock/pull
  65: 'salida', 66: 'salida', // locked by keypad (con/sin pin)
  77: 'entrada', 78: 'entrada', 79: 'entrada', 80: 'entrada', 81: 'entrada', // huella
}

/** Log de accesos reales desde la cloud (GET /api/v37/my/deviceactivity?deviceId=).
 *  Devuelve [{id, at, actorName, actorRole, type, lockId}] — NUNCA el PIN en claro.
 *  Solo cloud: el bridge local no expone deviceactivity. */
export async function tedeeAccesses(db) {
  if (!isCloudUrl(tedeeConfig(db).url)) return []
  const locks = await tedeeLocks(db)
  const out = []
  for (const l of locks) {
    const raw = await tedeeFetch(db, null, `/api/v37/my/deviceactivity?deviceId=${l.id}&elements=50`)
    const list = Array.isArray(raw?.result) ? raw.result : []
    for (const ev of list) {
      const type = ACCESS_EVENT_TYPE[ev.event]
      if (!type) continue
      // pinAlias = nombre de la persona asignada al PIN; nunca el código.
      const actorName = ev.pinAlias || ev.username || ev.accessLinkName || ''
      out.push({
        id: `td-${ev.id}`,
        at: ev.date ? new Date(ev.date) : new Date(),
        actorName,
        actorRole: ev.pinAlias || ev.username || ev.accessLinkName ? 'huésped' : 'propietario',
        type,
        propertyId: l.propertyId ?? '',
        lockId: String(l.id),
      })
    }
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime())
}
