// airbnb-sync.js — cruce de reservas de Airbnb con el scraper local.
//
// El scraper (proyecto local, fuera del repo) descarga /api/v2/reservations
// del panel de anfitrión cada hora y escribe dos ficheros JSON:
//   - <dir>/airbnb_reservas.json : [{confirmation_code, guests, amount, ...}]
//   - <dir>/airbnb_sesion.json    : {viva, ultimo_check, extraccion_ok, detalle}
// Keynest NO tiene las credenciales de Airbnb: solo lee esos ficheros.
//
// Este módulo:
//   1. Cruza por confirmation_code y completa guests + amount en reservations.
//   2. Si la sesión de Airbnb está muerta: PUSH CRÍTICO NO DESACTIVABLE
//      (forzar=true: ignora preferencias y quiet hours) + estado en kv para
//      que la UI muestre un ribbon que reaparece a las 24h si se descarta.
//
// La ruta se configura con AIRBNB_DATA_DIR (defecto /opt/airbnb-scraper/data).
import fs from 'node:fs'
import path from 'node:path'
import { kvGet, kvSet } from './db.js'
import { notifyAll } from './push.js'

const DEF_DIR = '/opt/airbnb-scraper/data'
const DEF_SESION = '/opt/airbnb-scraper/.auth/airbnb_session.json'
const CLAVE_ESTADO = 'airbnb_sesion'
const CLAVE_PAIRING = 'airbnb_pairing'
const PAIRING_TTL_MS = 10 * 60 * 1000
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function leerJSON(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf-8'))
  } catch {
    return null
  }
}

export function airbnbDataDir() {
  return process.env.AIRBNB_DATA_DIR || DEF_DIR
}

export function airbnbSessionPath() {
  return process.env.AIRBNB_SESSION_PATH || DEF_SESION
}

/** Código de emparejamiento vigente para subir una sesión nueva, o null. */
export function pairingVigente(db, ahora = Date.now()) {
  try {
    const p = JSON.parse(kvGet(db, CLAVE_PAIRING) || 'null')
    if (!p || !p.code || p.expira <= ahora) return null
    return p
  } catch {
    return null
  }
}

/** Genera un código de un solo uso (6 chars, caducidad 10 min) para que el
 *  capturador local pueda subir la sesión nueva a la webapp. */
export function crearPairing(db, ahora = Date.now()) {
  let code = ''
  for (let i = 0; i < 6; i++) code += PAIRING_ALPHABET[Math.floor(Math.random() * PAIRING_ALPHABET.length)]
  const expira = ahora + PAIRING_TTL_MS
  kvSet(db, CLAVE_PAIRING, JSON.stringify({ code, expira }))
  return { code, expira }
}

/** Consume el código si es el vigente (single-use). Devuelve false si no. */
export function consumirPairing(db, code, ahora = Date.now()) {
  const vigente = pairingVigente(db, ahora)
  if (!vigente || vigente.code !== code) return false
  kvSet(db, CLAVE_PAIRING, '')
  return true
}

/** Escribe el storage_state del capturador como sesión del scraper (mode 600,
 *  escritura atómica tmp+rename). Los datos viajan en memoria, nunca en texto
 *  de salida del server. */
export function guardarSesion(session) {
  const ruta = airbnbSessionPath()
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
  const tmp = `${ruta}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(session), { mode: 0o600 })
  fs.renameSync(tmp, ruta)
  fs.chmodSync(ruta, 0o600)
  return ruta
}

/**
 * Devuelve el estado de la sesión de Airbnb para la UI (ribbon).
 * El ribbon es descartable; el frontend decide cuándo reaparece (24h).
 */
export function airbnbStatus(db) {
  const s = leerJSON(path.join(airbnbDataDir(), 'airbnb_sesion.json'))
  let prev = {}
  try { prev = JSON.parse(kvGet(db, CLAVE_ESTADO) || '{}') } catch { /* noop */ }
  return {
    sesion: s || { viva: false, detalle: 'no hay fichero de estado del scraper' },
    estadoGuardado: prev,
  }
}

/**
 * Cruza las reservas del scraper contra la BD por confirmation_code y
 * actualiza guests + amount. Devuelve {cruzadas, sinMatch, sesionViva}.
 * El push de sesión muerta es FUERA de aquí (lo lanza el job con la BD real)
 * porque notifyAll necesita la BD; aquí no hay BD propia.
 */
export function aplicarCruce(db) {
  const dir = airbnbDataDir()
  const reservas = leerJSON(path.join(dir, 'airbnb_reservas.json'))
  const sesion = leerJSON(path.join(dir, 'airbnb_sesion.json'))

  const stmtGet = db.prepare('SELECT id FROM reservations WHERE confirmation_code = ?')
  const stmtUpd = db.prepare('UPDATE reservations SET guests = ?, amount = ? WHERE id = ?')
  let cruzadas = 0
  let sinMatch = 0

  if (reservas && Array.isArray(reservas.reservas)) {
    const tx = db.transaction(() => {
      for (const r of reservas.reservas) {
        if (!r || !r.confirmation_code) continue
        const fila = stmtGet.get(r.confirmation_code)
        if (!fila) { sinMatch++; continue }
        stmtUpd.run(r.guests ?? null, r.amount ?? null, fila.id)
        cruzadas++
      }
    })
    tx()
  }

  const viva = sesion?.viva !== false
  kvSet(db, CLAVE_ESTADO, JSON.stringify({
    viva,
    ultimo_check: sesion?.ultimo_check || null,
    extraccion_ok: !!sesion?.extraccion_ok,
    detalle: sesion?.detalle || null,
  }))
  return { cruzadas, sinMatch, sesionViva: viva }
}

/**
 * Job horario: cruce + aviso de sesión muerta (push crítico NO desactivable).
 * Solo lanza el push en el flanco (viva→muerta) para no spamear; el ribbon
 * de la UI se alimenta del estado guardado por aplicarCruce.
 */
export async function syncAirbnb(db) {
  const dir = airbnbDataDir()
  const sesion = leerJSON(path.join(dir, 'airbnb_sesion.json'))
  const anterior = (() => { try { return JSON.parse(kvGet(db, CLAVE_ESTADO) || '{}') } catch { return {} } })()

  const res = aplicarCruce(db)

  const ahoraMuerta = res.sesionViva === false
  const antesMuerta = anterior.viva === false
  if (ahoraMuerta && !antesMuerta) {
    const detalle = sesion?.detalle || 'sesión caducada'
    console.error(`[airbnb] sesión muerta, push crítico: ${detalle}`)
    notifyAll(db, 'airbnb_sesion_caida', { detalle }, { severity: 'critical', url: '/reservas', forzar: true })
  } else if (!ahoraMuerta && antesMuerta) {
    console.log('[airbnb] sesión recuperada')
    notifyAll(db, 'airbnb_sesion_ok', {}, { severity: 'normal', url: '/reservas' })
  }
  console.log(`[airbnb] cruce: ${res.cruzadas} reservas, ${res.sinMatch} sin match, sesión ${res.sesionViva ? 'viva' : 'MUERTA'}`)
  return res
}
