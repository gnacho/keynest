import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { kvGet, kvSet } from './db.js'

const COOKIE_NAME = 'keynest_session'
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000 // 7d

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex')
}

/* session_secret: lee de SESSION_SECRET en entorno; fallback a kv con warning */
let _sessionSecretWarned = false
function sessionSecret(db) {
  const envSecret = process.env.SESSION_SECRET
  if (envSecret && envSecret.length >= 32) return envSecret
  if (!_sessionSecretWarned) {
    console.warn('[auth] SESSION_SECRET no definida en entorno, usando clave en BD (menos seguro)')
    _sessionSecretWarned = true
  }
  let s = kvGet(db, 'session_secret')
  if (!s) {
    s = crypto.randomBytes(32).toString('hex')
    kvSet(db, 'session_secret', s)
  }
  return s
}

export async function ensureBootstrapAdmin(db, config) {
  if (!config.authUser || !config.authPass) return
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(config.authUser)
  if (existing) return
  const hash = await bcrypt.hash(config.authPass, 10)
  db.prepare('INSERT INTO users (id, username, password_hash, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), config.authUser, hash, 'auto', 'admin', Date.now())
  console.log(`[auth] admin bootstrap creado: ${config.authUser}`)
}

/* IP del cliente: socket real por defecto; XFF solo si TRUST_PROXY=true (detrás de proxy inverso) */
function clientIp(c) {
  if (process.env.TRUST_PROXY === 'true') {
    const xff = c.req.header('x-forwarded-for')
    if (xff) return xff.split(',')[0].trim()
  }
  const req = c.req.raw
  const socket = req?.socket || req?.connection
  return socket?.remoteAddress || 'unknown'
}

/* Rate limit general para acciones costosas (sync, uploads).
 * Tabla separada: action + ip, con ventana de 1 minuto y límite configurable. */
export function rateLimitAction(db, action, c, maxPerMinute = 10) {
  const ip = clientIp(c)
  const key = `${action}:${ip}`
  const now = Date.now()
  const windowMs = 60 * 1000
  const row = db.prepare('SELECT * FROM rate_limits WHERE key = ?').get(key)
  if (!row || row.window_end < now) {
    db.prepare('INSERT INTO rate_limits (key, count, window_end) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_end = excluded.window_end')
      .run(key, now + windowMs)
    return false
  }
  if (row.count >= maxPerMinute) return true
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key)
  return false
}

export function loginRateLimited(db, c) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(clientIp(c))
  return Boolean(row && row.locked_until > Date.now())
}

export function registerLoginFail(db, c) {
  const ip = clientIp(c)
  db.prepare(`
    INSERT INTO login_attempts (ip, attempts, locked_until) VALUES (?, 1, 0)
    ON CONFLICT(ip) DO UPDATE SET
      attempts = attempts + 1,
      locked_until = CASE WHEN attempts >= 4 THEN ? ELSE locked_until END
  `).run(ip, Date.now() + 5 * 60 * 1000)
}

export function loginOk(db, c) {
  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(clientIp(c))
}

function createSession(db, userId, ua, isDemo = false) {
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, Date.now(), Date.now() + SESSION_TTL_MS, ua || '', isDemo ? 1 : 0)
  return id
}

export function sessionFromCookie(db, c) {
  const raw = getCookie(c)[COOKIE_NAME]
  if (!raw) return null
  const [id, mac] = raw.split('.')
  if (!id || !mac) return null
  const expected = hmac(sessionSecret(db), id)
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!s || s.expires_at < Date.now()) return null
  return s
}

/** Usuario de la sesión; las sesiones viven en prodDb y el flag is_demo decide la BD de datos. */
export function currentUser(prodDb, demoDb, c) {
  const s = sessionFromCookie(prodDb, c)
  if (!s) return null
  const dataDb = s.is_demo ? demoDb : prodDb
  const user = dataDb.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, created_at FROM users WHERE id = ?').get(s.user_id) || null
  if (!user) return null
  return { ...user, is_demo: Boolean(s.is_demo) }
}

export function requireAuth(prodDb, demoDb) {
  return async (c, next) => {
    const user = currentUser(prodDb, demoDb, c)
    if (!user) return c.json({ error: 'no autorizado' }, 401)
    c.set('user', user)
    c.set('db', user.is_demo ? demoDb : prodDb)
    await next()
  }
}

/** requireAuth + rol admin (factorizado: antes se repetía el check en ~11 endpoints). */
export function requireAdmin(prodDb, demoDb) {
  return async (c, next) => {
    const user = currentUser(prodDb, demoDb, c)
    if (!user) return c.json({ error: 'no autorizado' }, 401)
    if (user.role !== 'admin') return c.json({ error: 'solo admin' }, 403)
    c.set('user', user)
    c.set('db', user.is_demo ? demoDb : prodDb)
    await next()
  }
}

/** Login demo sin contraseña (un clic). Solo si demo_enabled (kv de prod). */
export function demoEnabled(prodDb) {
  return kvGet(prodDb, 'demo_enabled') !== '0'
}

export function handleDemoLogin(prodDb, c) {
  if (!demoEnabled(prodDb)) return null
  const id = createSession(prodDb, 'demo-user', c.req.header('user-agent'), true)
  const mac = hmac(sessionSecret(prodDb), id)
  setCookie(c, COOKIE_NAME, `${id}.${mac}`, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  })
  return { id: 'demo-user', username: 'demo', email: null, phone: null, language: 'auto', role: 'demo', is_demo: true }
}

export async function handleLogin(db, c, { username, password, remember }) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '')
  if (!user) return null
  const valid = await bcrypt.compare(password || '', user.password_hash)
  if (!valid) return null
  const id = createSession(db, user.id, c.req.header('user-agent'))
  const mac = hmac(sessionSecret(db), id)
  // Recuérdame: cookie 7d. Sin marcar: cookie de sesión (muere al cerrar el navegador)
  setCookie(c, COOKIE_NAME, `${id}.${mac}`, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    ...(remember ? { maxAge: SESSION_TTL_MS / 1000 } : {}),
    path: '/',
  })
  const { password_hash, ...pub } = user
  return pub
}

export function handleLogout(db, c) {
  const s = sessionFromCookie(db, c)
  if (s) db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id)
  deleteCookie(c, COOKIE_NAME, { path: '/' })
}

/** Cambio de contraseña: verifica la actual con bcrypt antes de re-hashear. */
export async function changePassword(db, userId, current, next) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!user) return 'error'
  const ok = await bcrypt.compare(current, user.password_hash)
  if (!ok) return 'wrong-current'
  const hash = await bcrypt.hash(next, 10)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId)
  return 'ok'
}

/** Destruye las sesiones de un usuario salvo la actual (cambio de contraseña). */
export function destroyOtherSessions(db, userId, currentToken) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, currentToken)
}

/** Alta de usuario (admin): password inicial obligatoria (≥6 en la ruta). */
export async function createUser(db, { username, password, phone, role }) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) return null
  const hash = await bcrypt.hash(password, 10)
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO users (id, username, password_hash, phone, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, username, hash, phone || null, 'auto', role || 'user', Date.now())
  return db.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, created_at FROM users WHERE id = ?').get(id)
}

export function updateLanguage(db, userId, language) {
  db.prepare('UPDATE users SET language = ? WHERE id = ?').run(language, userId)
  return db.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, created_at FROM users WHERE id = ?').get(userId)
}

/** Días de aviso del panel por usuario (1-30; 0 = defecto global). */
export function updateLookaheadDays(db, userId, days) {
  db.prepare('UPDATE users SET lookahead_days = ? WHERE id = ?').run(days, userId)
  return db.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, created_at FROM users WHERE id = ?').get(userId)
}

/** Reset de contraseña por un admin: re-hashea y destruye las sesiones del usuario. */
export async function setUserPassword(db, userId, password) {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
  if (!user) return false
  const hash = await bcrypt.hash(password, 10)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  return true
}

export function setUserRole(db, userId, role) {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId)
  return db.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, created_at FROM users WHERE id = ?').get(userId)
}

export function countAdmins(db) {
  return db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get().n
}

export function deleteUser(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  return db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0
}

export function cleanExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
}
