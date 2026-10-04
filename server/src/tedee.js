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
 *  propertyId se cruza con properties.tedee_lock_id (si hay match).
 *  soloAsignadas (#277): devuelve solo las cerraduras asignadas a un inmueble;
 *  el resto es ruido de la cuenta (no se muestra ni se notifica). */
export async function tedeeLocks(db, { soloAsignadas = false } = {}) {
  const cloud = isCloudUrl(tedeeConfig(db).url)
  const raw = await tedeeFetch(db, '/v1.0/lock', '/api/v37/my/lock')
  // lock_id Tedee → property_id de Keynest (para asociar accesos a inmuebles)
  const propByLock = new Map()
  for (const p of db.prepare('SELECT id, tedee_lock_id FROM properties WHERE tedee_lock_id IS NOT NULL').all()) {
    propByLock.set(Number(p.tedee_lock_id), p.id)
  }
  let todas
  if (cloud) {
    const list = Array.isArray(raw?.result) ? raw.result : []
    todas = list.map((l) => ({
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
  } else {
    if (!Array.isArray(raw)) return []
    todas = raw.map((l) => ({
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
  if (soloAsignadas) return todas.filter((l) => l.propertyId !== '')
  return todas
}

/** Reservas con nombre de huésped agrupadas por inmueble (#277). */
function reservasConHuesped(db) {
  const porProp = new Map()
  const filas = db
    .prepare(
      `SELECT property_id, guest_name, checkin, checkout FROM reservations WHERE TRIM(COALESCE(guest_name, '')) != ''`,
    )
    .all()
  for (const r of filas) {
    if (!porProp.has(r.property_id)) porProp.set(r.property_id, [])
    porProp.get(r.property_id).push(r)
  }
  return porProp
}

/** Fecha local YYYY-MM-DD de un Date: los checkin/checkout de reservas son fechas
 *  locales del inmueble, no días UTC (un acceso a las 00:30 de Madrid es UTC del día anterior). */
function fechaLocal(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}

/** Inquilino cuya estancia cubre la fecha local del acceso (#277).
 *  Rango inclusivo [checkin, checkout]: cubre tanto la entrada como la salida del mismo huésped.
 *  Empate (checkout de uno y checkin de otro el mismo día): gana el ya alojado (checkin < fecha). */
function inquilinoEnFecha(reservas, fecha) {
  let elegida = null
  for (const r of reservas || []) {
    if (fecha < r.checkin || fecha > r.checkout) continue
    if (!elegida || (r.checkin < fecha && elegida.checkin >= fecha)) elegida = r
  }
  return elegida?.guest_name || ''
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
 *  Devuelve [{id, at, actorName, actorRole, type, propertyId, lockId, guestName}]
 *  — NUNCA el PIN en claro. guestName (#277) = inquilino de la reserva activa del
 *  inmueble en la fecha del acceso ('' si no hay match).
 *  Solo cloud: el bridge local no expone deviceactivity. */
export async function tedeeAccesses(db) {
  if (!isCloudUrl(tedeeConfig(db).url)) return []
  // Solo cerraduras asignadas a un inmueble (#277): el resto se oculta.
  const locks = await tedeeLocks(db, { soloAsignadas: true })
  const reservasPorProp = reservasConHuesped(db)
  const out = []
  for (const l of locks) {
    const raw = await tedeeFetch(db, null, `/api/v37/my/deviceactivity?deviceId=${l.id}&elements=50`)
    const list = Array.isArray(raw?.result) ? raw.result : []
    for (const ev of list) {
      const type = ACCESS_EVENT_TYPE[ev.event]
      if (!type) continue
      const at = ev.date ? new Date(ev.date) : new Date()
      // pinAlias = nombre de la persona asignada al PIN; nunca el código.
      const actorName = ev.pinAlias || ev.username || ev.accessLinkName || ''
      const guestName = inquilinoEnFecha(reservasPorProp.get(l.propertyId), fechaLocal(at))
      out.push({
        id: `td-${ev.id}`,
        at,
        actorName,
        actorRole: actorName || guestName ? 'huésped' : 'propietario',
        type,
        propertyId: l.propertyId ?? '',
        lockId: String(l.id),
        guestName,
      })
    }
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime())
}
