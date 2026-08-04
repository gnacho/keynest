// push.js — Web Push (VAPID) para Keynest: configuración, motor de envío con
// i18n server-side (es/en), preferencias por usuario, quiet hours con cola
// consolidada y borrado de suscripciones muertas (404/410).
// Patrón: skill web-push-alerts, adaptado de Deltos/Helios.
//
// Decisiones propias de Keynest:
// - SIN fail-fast sin claves VAPID: en LAN HTTP el push está dormido por
//   secure context; la app arranca igual y la UI muestra "Requiere HTTPS".
// - Dos BD (prod/demo): los statements se cachean por BD con un WeakMap y
//   notifyUsers recibe la BD objetivo. En demo NUNCA se envía push real
//   (flag demo, como Deltos).
// - Las alertas son operativas (reservas, limpiezas, cerradura): se notifican
//   a TODOS los usuarios; las preferencias por tipo filtran por usuario.
import crypto from 'node:crypto'
import webpush from 'web-push'

let vapidOk = false
let sendFn = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts)

// Configura VAPID una vez al arrancar. Devuelve true si el push queda activo.
export function configurePush({ publicKey, privateKey, subject } = {}) {
  if (!publicKey || !privateKey || !subject) {
    vapidOk = false
    console.warn('[push] sin VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT: notificaciones push desactivadas')
    return false
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidOk = true
  console.log('[push] VAPID configurado: notificaciones push activas')
  return true
}

export function isPushConfigured() {
  return vapidOk
}

export function pushPublicKey() {
  return vapidOk ? process.env.VAPID_PUBLIC_KEY : null
}

// --- Tests: inyectar un sender falso y resetear estado ----------------------
export function _setSendFn(fn) {
  sendFn = fn || ((sub, payload, opts) => webpush.sendNotification(sub, payload, opts))
}
export function _resetForTests() {
  vapidOk = false
  _setSendFn(null)
  stmtCache = new WeakMap()
}

// --- Catálogo i18n (texto FINAL compuesto en servidor; el SW no traduce) ----
const CATALOGO = {
  es: {
    checkin_hoy: { titulo: 'Check-in hoy', cuerpo: (d) => `${d.propiedad}: entra «${d.resumen}»` },
    checkout_hoy: { titulo: 'Check-out hoy', cuerpo: (d) => `${d.propiedad}: sale «${d.resumen}»` },
    reserva_nueva: { titulo: 'Reserva nueva', cuerpo: (d) => `${d.propiedad}: «${d.resumen}» (${d.fecha})` },
    reservas_nuevas: { titulo: 'Reservas nuevas', cuerpo: (d) => `${d.total} reservas nuevas importadas` },
    tedee_offline: { titulo: 'Cerradura offline', cuerpo: (d) => `La cerradura «${d.nombre}» no responde` },
    tedee_ok: { titulo: 'Cerradura recuperada', cuerpo: (d) => `La cerradura «${d.nombre}» vuelve a estar online` },
    tedee_bateria: { titulo: 'Batería cerradura baja', cuerpo: (d) => `«${d.nombre}» al ${d.nivel}%` },
    limpieza_pendiente: { titulo: 'Limpieza pendiente', cuerpo: (d) => `${d.propiedad}: limpieza del ${d.fecha} sin completar` },
    resumen: { titulo: 'Actividad en Keynest', cuerpo: (d) => `${d.total} avisos durante las horas de silencio` },
  },
  en: {
    checkin_hoy: { titulo: 'Check-in today', cuerpo: (d) => `${d.propiedad}: “${d.resumen}” arrives` },
    checkout_hoy: { titulo: 'Check-out today', cuerpo: (d) => `${d.propiedad}: “${d.resumen}” leaves` },
    reserva_nueva: { titulo: 'New booking', cuerpo: (d) => `${d.propiedad}: “${d.resumen}” (${d.fecha})` },
    reservas_nuevas: { titulo: 'New bookings', cuerpo: (d) => `${d.total} new bookings imported` },
    tedee_offline: { titulo: 'Lock offline', cuerpo: (d) => `Lock “${d.nombre}” is not responding` },
    tedee_ok: { titulo: 'Lock recovered', cuerpo: (d) => `Lock “${d.nombre}” is back online` },
    tedee_bateria: { titulo: 'Low lock battery', cuerpo: (d) => `“${d.nombre}” at ${d.nivel}%` },
    limpieza_pendiente: { titulo: 'Cleaning pending', cuerpo: (d) => `${d.propiedad}: cleaning from ${d.fecha} not completed` },
    resumen: { titulo: 'Keynest activity', cuerpo: (d) => `${d.total} alerts during your quiet hours` },
  },
}

// Tipos de alerta conocidos (para validación de preferencias).
export const TIPOS_ALERTA = [
  'checkin_hoy',
  'checkout_hoy',
  'reserva_nueva',
  'tedee_offline',
  'tedee_ok',
  'tedee_bateria',
  'limpieza_pendiente',
]

const SEVERIDADES = ['normal', 'high', 'critical']

// --- Statements cacheados por BD (WeakMap: prod y demo comparten código) ----
let stmtCache = new WeakMap()
function stmts(db) {
  let s = stmtCache.get(db)
  if (!s) {
    s = {
      subsPorUsuario: db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'),
      idioma: db.prepare('SELECT language FROM users WHERE id = ?'),
      notifLevel: db.prepare('SELECT notification_level FROM users WHERE id = ?'),
      pref: db.prepare('SELECT enabled, min_severity FROM notification_preferences WHERE user_id = ? AND tipo = ?'),
      quiet: db.prepare('SELECT quiet_start, quiet_end, tz FROM notification_quiet_hours WHERE user_id = ?'),
      borrarPorEndpoint: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
      encolar: db.prepare('INSERT INTO notification_queue (id, user_id, tipo, severity, datos_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
      colaAgrupada: db.prepare(
        `SELECT user_id, tipo, severity, COUNT(*) AS total, MIN(datos_json) AS datos_json
         FROM notification_queue GROUP BY user_id, tipo, severity`
      ),
      todosUsuarios: db.prepare('SELECT id FROM users'),
    }
    stmtCache.set(db, s)
  }
  return s
}

function idiomaDe(db, userId) {
  const lang = stmts(db).idioma.get(userId)?.language
  return lang === 'en' ? 'en' : 'es' // 'auto' y desconocidos → es (defecto de la casa)
}

// Quiet hours en la zona horaria del usuario (Intl, sin dependencias).
function enQuietHours(db, userId) {
  const q = stmts(db).quiet.get(userId)
  if (!q || q.quiet_start === null || q.quiet_end === null) return false
  const hora = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: q.tz }).format(new Date())
  )
  if (q.quiet_start <= q.quiet_end) return hora >= q.quiet_start && hora < q.quiet_end
  return hora >= q.quiet_start || hora < q.quiet_end // cruza medianoche
}

function componerPayload(lang, tipo, datos, url) {
  const entrada = CATALOGO[lang][tipo] || CATALOGO[lang].resumen
  const title = entrada.titulo
  const body = entrada.cuerpo(datos)
  return JSON.stringify({
    // Campos planos → handler push del SW (Chrome/Firefox/Safari)
    title,
    body,
    url,
    tag: tipo, // coalescing: mismo tag reemplaza la notificación anterior
    // Declarative Web Push (Safari/iOS 18.4+, sin ejecutar el SW)
    web_push: 8030,
    notification: { title, body, navigate: url },
  })
}

// Envío a UNA suscripción: 404/410 = muerta (borrar); 429/5xx = reintentar
// con backoff + jitter (máx 3); otros status = bug nuestro (log sin endpoint).
async function enviarAUna(db, sub, json, opciones) {
  const destino = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }
  for (let intento = 1; intento <= 3; intento++) {
    try {
      await sendFn(destino, json, { ...opciones, contentEncoding: 'aes128gcm' })
      return 'ok'
    } catch (err) {
      const status = err?.statusCode
      if (status === 404 || status === 410) {
        stmts(db).borrarPorEndpoint.run(sub.endpoint)
        return 'borrada'
      }
      if (status === 429 || (status !== undefined && status >= 500)) {
        if (intento < 3) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** intento + Math.floor(Math.random() * 250)))
          continue
        }
        return 'fallido'
      }
      console.error(`[push] error status=${status} sub=${sub.id}: ${err?.message}`)
      return 'fallido'
    }
  }
  return 'fallido'
}

/**
 * Notifica por push a usuarios (app CERRADA; con la app abierta ya se entera
 * por la propia UI). Respeta preferencias y quiet hours; en demo solo registra.
 * db = la BD objetivo (prod o demo). Devuelve contadores.
 */
export async function notifyUsers(db, userIds, tipo, datos = {}, opciones = {}) {
  const { demo = false, severity = 'normal', url = '/', ttl = severity === 'critical' ? 3600 : 21600 } = opciones
  const res = { enviados: 0, borrados: 0, fallidos: 0, pospuestos: 0, omitidos: 0 }
  const s = stmts(db)

  for (const userId of [...new Set(userIds)]) {
    const level = s.notifLevel.get(userId)?.notification_level || 'all'
    if (level === 'none') { res.omitidos++; continue }
    if (level === 'important' && SEVERIDADES.indexOf(severity) < SEVERIDADES.indexOf('high')) { res.omitidos++; continue }
    const pref = s.pref.get(userId, tipo)
    if (pref) {
      if (!pref.enabled || SEVERIDADES.indexOf(severity) < SEVERIDADES.indexOf(pref.min_severity)) {
        res.omitidos++
        continue
      }
    }
    if (severity !== 'critical' && enQuietHours(db, userId)) {
      s.encolar.run(crypto.randomUUID(), userId, tipo, severity, JSON.stringify(datos), Date.now())
      res.pospuestos++
      continue
    }
    const lang = idiomaDe(db, userId)
    const json = componerPayload(lang, tipo, datos, url)
    if (demo) {
      console.log(`[push:demo] user=${userId} tipo=${tipo} (sin envío real)`)
      res.omitidos++
      continue
    }
    if (!vapidOk) {
      res.omitidos++
      continue
    }
    const subs = s.subsPorUsuario.all(userId)
    if (subs.length === 0) {
      res.omitidos++
      continue
    }
    const urgency = severity === 'critical' ? 'high' : severity === 'high' ? 'normal' : 'low'
    const resultados = await Promise.allSettled(subs.map((sub) => enviarAUna(db, sub, json, { TTL: ttl, urgency, topic: tipo })))
    for (const r of resultados) {
      if (r.status === 'fulfilled' && r.value === 'ok') res.enviados++
      else if (r.status === 'fulfilled' && r.value === 'borrada') res.borrados++
      else res.fallidos++
    }
  }
  return res
}

// Atajo para alertas operativas: avisa a TODOS los usuarios de la BD dada.
// Fire-and-forget desde el motor (nunca bloquea el tick del motor).
export function notifyAll(db, tipo, datos, opciones = {}) {
  const ids = stmts(db).todosUsuarios.all().map((r) => r.id)
  if (ids.length === 0) return
  notifyUsers(db, ids, tipo, datos, opciones).catch((err) => console.error('[push] error en notifyAll:', err))
}

// Mantenimiento horario: consolida la cola de quiet hours en UN resumen por
// usuario+tipo y vacía la cola. Llamado desde el intervalo horario de index.js.
export async function flushNotificationQueue(db, demo = false) {
  const s = stmts(db)
  const grupos = s.colaAgrupada.all()
  if (grupos.length === 0) return
  for (const g of grupos) {
    // Fuera de quiet hours ya: se entrega el resumen. Si sigue en ventana, se
    // queda en cola para el próximo tick.
    if (enQuietHours(db, g.user_id)) continue
    await notifyUsers(db, [g.user_id], 'resumen', { total: g.total }, { demo, severity: g.severity })
    db.prepare('DELETE FROM notification_queue WHERE user_id = ? AND tipo = ?').run(g.user_id, g.tipo)
  }
}
