import crypto from 'node:crypto'
import { decryptSecret, encryptSecret, kvGet, kvSet } from './db.js'
import type { DB } from './db.js'

export interface TedeeKeypad {
  name: string
  battery: number
  modified: string | null
}

export interface TedeeLock {
  id: number
  name: string
  battery: number
  online: boolean
  rssi: number | null
  state: number | null
  jammed: boolean
  serial: string
  propertyId: string
  keypad: TedeeKeypad | null
}

interface TedeeLockBase {
  id: number
  name: string
  battery: number
  online: boolean
  rssi: number | null
  state: number | null
  jammed: boolean
  serial: string
  propertyId: string
}

export interface TedeeAccess {
  id: string
  at: Date
  actorName: string
  actorRole: string
  type: string
  propertyId: string
  lockId: string
  guestName: string
}

/** Config Tedee guardada en kv de la BD de producción. */
export function tedeeConfig(db: DB) {
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

export function saveTedeeConfig(db: DB, url: string, token: string): void {
  kvSet(db, 'tedee_url', url.replace(/\/+$/, ''))
  if (token) kvSet(db, 'tedee_token', encryptSecret(db, token))
}

/** Header api_token: hex(sha256(token+ts)) + ts — verificado contra bridge real 31-Jul-2026. */
function authHeader(token: string): string {
  const ts = Date.now().toString()
  const hash = crypto.createHash('sha256').update(token + ts).digest('hex')
  return hash + ts
}

/** ¿API cloud pública (api.tedee.com)? Esquema PAK: Authorization: PersonalKey <PAK>.
 *  Si no, es el bridge LOCAL (api_token: sha256(token+ts)+ts). */
function isCloudUrl(url: string): boolean {
  try {
    return /(^|\.)tedee\.com$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

export async function tedeeFetch(db: DB, path: string | null, cloudPath: string): Promise<any> {
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

/** Batería de los teclados (keypads) emparejados con cada cerradura (#279).
 *  GET /api/v37/my/device/details?IncludeAccessories=true → result.keypads[]
 *  con deviceState.batteryLevel (batteryLevelModifiedDateTime solo si <30 días,
 *  docs oficiales) y connectedToLockId → cerradura emparejada.
 *  Solo cloud: el bridge local no expone keypads. Devuelve Map(lockId →
 *  {name, battery, modified}); ante error devuelve Map vacío para que las
 *  cerraduras no dejen de cargarse por el teclado. */
export async function tecladosPorCerradura(db: DB): Promise<Map<number, TedeeKeypad>> {
  const mapa = new Map<number, TedeeKeypad>()
  if (!isCloudUrl(tedeeConfig(db).url)) return mapa
  try {
    const raw = await tedeeFetch(db, null, '/api/v37/my/device/details?IncludeAccessories=true')
    const list = Array.isArray(raw?.result?.keypads) ? raw.result.keypads : []
    for (const k of list) {
      const lockId = Number(k.connectedToLockId)
      const battery = k.deviceState?.batteryLevel
      if (!lockId || typeof battery !== 'number') continue
      mapa.set(lockId, {
        name: k.name || 'Keypad',
        battery,
        modified: k.deviceState?.batteryLevelModifiedTime ?? null,
      })
    }
  } catch { /* sin teclados visibles: seguimos con las cerraduras */ }
  return mapa
}

/** Lista de cerraduras: [{id, name, battery, online, rssi, state, serial, propertyId, keypad}]
 *  Bridge: GET /v1.0/lock. Cloud: GET /api/v37/my/lock (PAK).
 *  propertyId se cruza con properties.tedee_lock_id (si hay match).
 *  soloAsignadas (#277): devuelve solo las cerraduras asignadas a un inmueble;
 *  el resto es ruido de la cuenta (no se muestra ni se notifica).
 *  keypad (#279): teclado emparejado {name, battery, modified} o null. */
export async function tedeeLocks(db: DB, { soloAsignadas = false } = {}): Promise<TedeeLock[]> {
  const cloud = isCloudUrl(tedeeConfig(db).url)
  const raw = await tedeeFetch(db, '/v1.0/lock', '/api/v37/my/lock')
  // lock_id Tedee → property_id de Keynest (para asociar accesos a inmuebles)
  const propByLock = new Map<number, string>()
  for (const p of db.prepare('SELECT id, tedee_lock_id FROM properties WHERE tedee_lock_id IS NOT NULL').all() as Array<{ id: string; tedee_lock_id: number | null }>) {
    propByLock.set(Number(p.tedee_lock_id), p.id)
  }
  let todas: TedeeLockBase[]
  if (cloud) {
    const list: any[] = Array.isArray(raw?.result) ? raw.result : []
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
  if (todas.length === 0) return []
  const teclados = await tecladosPorCerradura(db)
  if (soloAsignadas) return todas.filter((l) => l.propertyId !== '').map(conTeclado)
  return todas.map(conTeclado)

  /** #279: añade el teclado emparejado (null si no hay o no viene con batería). */
  function conTeclado(l: TedeeLockBase): TedeeLock {
    return { ...l, keypad: teclados.get(Number(l.id)) ?? null }
  }
}

/** Reservas con nombre de huésped agrupadas por inmueble (#277). */
function reservasConHuesped(db: DB): Map<string, Array<{ property_id: string; guest_name: string; checkin: string; checkout: string }>> {
  const porProp = new Map<string, Array<{ property_id: string; guest_name: string; checkin: string; checkout: string }>>()
  const filas = db
    .prepare(
      `SELECT property_id, guest_name, checkin, checkout FROM reservations WHERE TRIM(COALESCE(guest_name, '')) != ''`,
    )
    .all() as Array<{ property_id: string; guest_name: string; checkin: string; checkout: string }>
  for (const r of filas) {
    if (!porProp.has(r.property_id)) porProp.set(r.property_id, [])
    porProp.get(r.property_id)!.push(r)
  }
  return porProp
}

/** Fecha local YYYY-MM-DD de un Date: los checkin/checkout de reservas son fechas
 *  locales del inmueble, no días UTC (un acceso a las 00:30 de Madrid es UTC del día anterior). */
function fechaLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}

/** Inquilino cuya estancia cubre la fecha local del acceso (#277).
 *  Rango inclusivo [checkin, checkout]: cubre tanto la entrada como la salida del mismo huésped.
 *  Empate (checkout de uno y checkin de otro el mismo día): gana el ya alojado (checkin < fecha). */
function inquilinoEnFecha(reservas: Array<{ checkin: string; checkout: string; guest_name: string }> | undefined, fecha: string): string {
  let elegida: { checkin: string; checkout: string; guest_name: string } | null = null
  for (const r of reservas || []) {
    if (fecha < r.checkin || fecha > r.checkout) continue
    if (!elegida || (r.checkin < fecha && elegida.checkin >= fecha)) elegida = r
  }
  return elegida?.guest_name || ''
}

/** Eventos de deviceactivity que suponen un ACCESO real (abrir/cerrar por persona).
 *  Unlock/pull por PIN, huella o app → entrada; lock por PIN/teclado/botón/manual → salida;
 *  acciones remotas desde la app → remota. Los eventos de sistema (batería,
 *  calibración, auto-lock sin actor, jammed…) se ignoran.
 *  Fuente: docs oficiales event-type (tedee-tedee-api-doc). */
const ACCESS_EVENT_TYPE: Record<number, string> = {
  32: 'remota', 33: 'remota', 35: 'remota', // lock remoto / unlock remoto/botón
  34: 'salida', // LockedButton: cerrar con el botón del lock
  38: 'salida', // LockedManual: cerrar manualmente
  51: 'remota', 52: 'remota', 53: 'remota', // pull spring
  61: 'entrada', 63: 'entrada', 64: 'entrada', 76: 'entrada', // pin unlock/pull
  65: 'salida', 66: 'salida', // locked by keypad (con/sin pin)
  68: 'entrada', // ForceUnlockedByPin
  77: 'entrada', 78: 'entrada', 79: 'entrada', 80: 'entrada', 81: 'entrada', // huella
}

/** Log de accesos reales desde la cloud (GET /api/v37/my/deviceactivity?deviceId=).
 *  Devuelve [{id, at, actorName, actorRole, type, propertyId, lockId, guestName}]
 *  — NUNCA el PIN en claro. guestName (#277) = inquilino de la reserva activa del
 *  inmueble en la fecha del acceso ('' si no hay match). Solo se aplica al actor
 *  cuando NO es una persona conocida (#281): si el alias del evento coincide con
 *  una persona del maestro (limpieza/proveedor), ese es el actor real y su rol.
 *  Ventana por defecto: 90 días (200 eventos/página, máx. 8 páginas por
 *  cerradura; tope para no martillear la API en cada bootstrap; el bootstrap
 *  además cachea el resultado 10 min en index.js). Con 50 eventos no llegaba
 *  ni a 7 días con huéspedes activos y limpiezas como Flor no salían.
 *  Solo cloud: el bridge local no expone deviceactivity. */
export async function tedeeAccesses(db: DB, { dias = 90 } = {}): Promise<TedeeAccess[]> {
  if (!isCloudUrl(tedeeConfig(db).url)) return []
  // Solo cerraduras asignadas a un inmueble (#277): el resto se oculta.
  const locks = await tedeeLocks(db, { soloAsignadas: true })
  const reservasPorProp = reservasConHuesped(db)
  const rolPorNombre = new Map(
    (db.prepare('SELECT name, role FROM people').all() as Array<{ name: string; role: string }>).map((p) => [p.name.trim().toLowerCase(), p.role]),
  )
  const limite = Date.now() - dias * 86400000
  const vistos = new Set<string>()
  const out: TedeeAccess[] = []
  for (const l of locks) {
    // Paginación hacia atrás hasta cubrir la ventana completa (máx. 8 páginas).
    let lastElemDate = null
    for (let pagina = 0; pagina < 8; pagina++) {
      const raw = await tedeeFetch(db, null, `/api/v37/my/deviceactivity?deviceId=${l.id}&elements=200${lastElemDate ? `&lastElemDate=${encodeURIComponent(lastElemDate)}` : ''}`)
      const list = Array.isArray(raw?.result) ? raw.result : []
      if (list.length === 0) break
      for (const ev of list) {
        const type = ACCESS_EVENT_TYPE[ev.event]
        if (!type) continue
        const at = ev.date ? new Date(ev.date) : new Date()
        if (at.getTime() < limite) continue
        const id = `td-${ev.id}`
        if (vistos.has(id)) continue
        vistos.add(id)
        // pinAlias = nombre de la persona asignada al PIN; nunca el código.
        // La API devuelve userName (docs oficiales device-activity); se acepta
        // también username por compatibilidad con mocks/puentes antiguos.
        const pinAlias = ev.pinAlias || ''
        const username = ev.userName || ev.username || ''
        const accessLink = ev.accessLinkName || ''
        const actorName = pinAlias || username || accessLink
        const guestName = inquilinoEnFecha(reservasPorProp.get(l.propertyId), fechaLocal(at))
        // Rol (#281): actor (PIN o usuario de la app) que coincide con una persona
        // del maestro → su rol real (limpieza/proveedor), aunque haya estancia.
        // PIN o enlace de acceso sin match → huésped. Solo usuario de app →
        // propietario: un cierre con botón/manual o apertura remota no la hace el
        // inquilino. Sin actor, se conserva el cruce de reserva (#277).
        const norm = (s: string): string => s.trim().toLowerCase()
        const rolPersona = pinAlias
          ? rolPorNombre.get(norm(pinAlias))
          : username ? rolPorNombre.get(norm(username)) : undefined
        const actorRole = rolPersona
          ? rolPersona === 'limpieza' ? 'limpieza' : 'propietario'
          : pinAlias || accessLink ? 'huésped'
          : username ? 'propietario'
          : guestName ? 'huésped' : 'propietario'
        out.push({
          id,
          at,
          actorName,
          actorRole,
          type,
          propertyId: l.propertyId ?? '',
          lockId: String(l.id),
          guestName,
        })
      }
      const masViejo = list[list.length - 1].date ? new Date(list[list.length - 1].date).getTime() : 0
      lastElemDate = list[list.length - 1].date
      if (masViejo < limite || list.length < 200) break
    }
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime())
}
