import crypto from 'node:crypto'
import { isIP } from 'node:net'
import bcrypt from 'bcryptjs'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context, Next } from 'hono'
import { kvGet, kvSet } from './db.js'
import type { DB, UserRow } from './db.js'

export interface AppEnv {
  Bindings: { incoming?: { socket?: { remoteAddress?: string } } }
  Variables: { db: DB; user: UserRow }
}

interface SessionRow {
  id: string
  user_id: string
  created_at: number
  expires_at: number
  ua: string | null
  is_demo: number
  remember: number
}

const COOKIE_NAME = 'keynest_session'
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000 // 30d
// Renovación deslizante: con menos de la mitad del TTL por delante se extiende
// expires_at y se re-emite la cookie (solo sesiones persistentes, #267).
const SESSION_RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2

function hmac(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex')
}

function sessionSecret(db: DB): string {
  const secret = process.env.SESSION_SECRET || kvGet(db, 'session_secret')
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is required')
  return secret
}

export async function ensureBootstrapAdmin(db: DB, config: { authUser?: string; authPass?: string }): Promise<void> {
  if (!config.authUser || !config.authPass) return
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(config.authUser) as { id: string } | undefined
  if (existing) return
  const hash = await bcrypt.hash(config.authPass, 10)
  db.prepare('INSERT INTO users (id, username, password_hash, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), config.authUser, hash, 'auto', 'admin', Date.now())
  console.log(`[auth] admin bootstrap creado: ${config.authUser}`)
}

/* IP del cliente para rate limits y lockout.
 *  Sin proxy de confianza se usa SIEMPRE la IP del socket: cualquier cliente
 *  puede inventarse X-Forwarded-For y así rotar la clave del rate limit.
 *  Con TRUST_PROXY=true el socket es el proxy, así que se usa el último salto
 *  de XFF (el que añadió ese proxy): los saltos anteriores los controla el
 *  cliente y son falsificables. Ese salto tiene que ser una IP de verdad; si un
 *  proxy reenvía la cabecera sin normalizar, un valor inventado dejaría rotar la
 *  clave del rate limit igual que sin proxy. Sin socket no se inventa nada. */
function normalizeIp(value: string | undefined): string | undefined {
  if (!value) return undefined
  let candidate = value.trim()
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate)
  if (bracketed) candidate = bracketed[1]
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) candidate = candidate.slice(0, candidate.lastIndexOf(':'))
  return isIP(candidate) ? candidate : undefined
}

export function clientIp(c: Context<AppEnv>): string {
  const req = c.req.raw as unknown as { socket?: { remoteAddress?: string }; connection?: { remoteAddress?: string } }
  const socket = normalizeIp((req?.socket || req?.connection)?.remoteAddress)
  if (process.env.TRUST_PROXY !== 'true') return socket || 'unknown'
  const xff = c.req.header('x-forwarded-for')
  const last = normalizeIp(xff?.split(',').filter((hop) => hop.trim()).at(-1))
  return last || socket || 'unknown'
}

/* Rate limit general para acciones costosas (sync, uploads).
 * Tabla separada: action + ip, con ventana de 1 minuto y límite configurable. */
export function rateLimitAction(db: DB, action: string, c: Context<AppEnv>, maxPerMinute = 10): boolean {
  const ip = clientIp(c)
  const key = `${action}:${ip}`
  const now = Date.now()
  const windowMs = 60 * 1000
  const row = db.prepare('SELECT * FROM rate_limits WHERE key = ?').get(key) as { window_end: number; count: number } | undefined
  if (!row || row.window_end < now) {
    db.prepare('INSERT INTO rate_limits (key, count, window_end) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_end = excluded.window_end')
      .run(key, now + windowMs)
    return false
  }
  if (row.count >= maxPerMinute) return true
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key)
  return false
}

export function loginRateLimited(db: DB, c: Context<AppEnv>): boolean {
  const row = db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(clientIp(c)) as { locked_until: number } | undefined
  return Boolean(row && row.locked_until > Date.now())
}

export function registerLoginFail(db: DB, c: Context<AppEnv>): void {
  const ip = clientIp(c)
  db.prepare(`
    INSERT INTO login_attempts (ip, attempts, locked_until) VALUES (?, 1, 0)
    ON CONFLICT(ip) DO UPDATE SET
      attempts = attempts + 1,
      locked_until = CASE WHEN attempts >= 4 THEN ? ELSE locked_until END
  `).run(ip, Date.now() + 5 * 60 * 1000)
}

export function loginOk(db: DB, c: Context<AppEnv>): void {
  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(clientIp(c))
}

function createSession(db: DB, userId: string, ua: string | null | undefined, isDemo = false, remember = false): string {
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo, remember) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, Date.now(), Date.now() + SESSION_TTL_MS, ua || '', isDemo ? 1 : 0, remember ? 1 : 0)
  return id
}

/* Renueva la expiración de una sesión persistente cuando queda por debajo del
 * umbral (expiración deslizante, #267). Las sesiones "no recuérdame" (cookie
 * de sesión) nunca se renuevan. Devuelve true si renovó (el caller re-emite
 * la cookie con maxAge fresco). */
export function renewSessionIfDue(db: DB, s: SessionRow | null): boolean {
  if (!s || !s.remember) return false
  const now = Date.now()
  if (s.expires_at - now >= SESSION_RENEW_THRESHOLD_MS) return false
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(now + SESSION_TTL_MS, s.id)
  s.expires_at = now + SESSION_TTL_MS
  return true
}

function renewCookie(db: DB, s: SessionRow, c: Context<AppEnv>): void {
  setCookie(c, COOKIE_NAME, `${s.id}.${hmac(sessionSecret(db), s.id)}`, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  })
}

export function sessionFromCookie(db: DB, c: Context<AppEnv>): SessionRow | null {
  const raw = getCookie(c)[COOKIE_NAME]
  if (!raw) return null
  const [id, mac] = raw.split('.')
  if (!id || !mac) return null
  const expected = hmac(sessionSecret(db), id)
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  if (!s || s.expires_at < Date.now()) return null
  return s
}

/** Usuario de la sesión; las sesiones viven en prodDb y el flag is_demo decide la BD de datos. */
export function currentUser(prodDb: DB, demoDb: DB, c: Context<AppEnv>, s: SessionRow | null = sessionFromCookie(prodDb, c)): UserRow | null {
  if (!s) return null
  const dataDb = s.is_demo ? demoDb : prodDb
  const user = dataDb.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, dismissed_notifs, created_at FROM users WHERE id = ?').get(s.user_id) as UserRow | undefined
  if (!user) return null
  return { ...user, is_demo: Boolean(s.is_demo) }
}

export function requireAuth(prodDb: DB, demoDb: DB): (c: Context<AppEnv>, next: Next) => Promise<Response | void> {
  return async (c: Context<AppEnv>, next: Next) => {
    const s = sessionFromCookie(prodDb, c)
    const user = currentUser(prodDb, demoDb, c, s)
    if (!user) return c.json({ error: 'no autorizado' }, 401)
    if (s && renewSessionIfDue(prodDb, s)) renewCookie(prodDb, s, c)
    c.set('user', user)
    c.set('db', user.is_demo ? demoDb : prodDb)
    await next()
  }
}

/** requireAuth + rol admin (factorizado: antes se repetía el check en ~11 endpoints). */
export function requireAdmin(prodDb: DB, demoDb: DB): (c: Context<AppEnv>, next: Next) => Promise<Response | void> {
  return async (c: Context<AppEnv>, next: Next) => {
    const s = sessionFromCookie(prodDb, c)
    const user = currentUser(prodDb, demoDb, c, s)
    if (!user) return c.json({ error: 'no autorizado' }, 401)
    if (user.role !== 'admin') return c.json({ error: 'solo admin' }, 403)
    if (s && renewSessionIfDue(prodDb, s)) renewCookie(prodDb, s, c)
    c.set('user', user)
    c.set('db', user.is_demo ? demoDb : prodDb)
    await next()
  }
}

/** Login demo sin contraseña (un clic). Solo si demo_enabled (kv de prod). */
export function demoEnabled(prodDb: DB): boolean {
  return kvGet(prodDb, 'demo_enabled') !== '0'
}

export function handleDemoLogin(prodDb: DB, c: Context<AppEnv>): UserRow | null {
  if (!demoEnabled(prodDb)) return null
  const id = createSession(prodDb, 'demo-user', c.req.header('user-agent'), true, true)
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

const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012'

export async function handleLogin(db: DB, c: Context<AppEnv>, { username, password, remember }: { username?: string; password?: string; remember?: boolean }): Promise<{ user: UserRow; restoreToken?: string } | null> {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '') as (UserRow & { password_hash: string }) | undefined
  if (!user) {
    await bcrypt.compare(password || '', DUMMY_HASH)
    return null
  }
  const valid = await bcrypt.compare(password || '', user.password_hash)
  if (!valid) return null
  const id = createSession(db, user.id, c.req.header('user-agent'), false, Boolean(remember))
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
  // Con recuerdame, token de re-autenticación: el cliente lo guarda en
  // localStorage y lo usa si el navegador pierde la cookie (#290).
  const restoreToken = remember ? createRestoreToken(db, user.id) : undefined
  return { user: pub, restoreToken }
}

export function handleLogout(db: DB, c: Context<AppEnv>): void {
  const s = sessionFromCookie(db, c)
  if (s) db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id)
  deleteCookie(c, COOKIE_NAME, { path: '/' })
}

/* ------------------------------------------------------------------------ */
/* Re-autenticación persistente (#290): token de larga duración en el cliente
 * que re-crea la sesión cuando el navegador pierde la cookie (purga agresiva
 * de cookies en algunos navegadores móviles). Alta entropía, guardado como
 * hash SHA-256 y rotación en cada uso. */

const RESTORE_TTL_MS = 90 * 24 * 3600 * 1000 // 90 días
const RESTORE_MAX_PER_USER = 5

function restoreTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Crea un token de restauración para el usuario (solo en login con recuerdame). */
export function createRestoreToken(db: DB, userId: string): string {
  const token = crypto.randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO login_tokens (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, restoreTokenHash(token), Date.now(), Date.now() + RESTORE_TTL_MS)
  db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(Date.now())
  for (const old of db.prepare('SELECT id FROM login_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?').all(userId, RESTORE_MAX_PER_USER) as Array<{ id: string }>) {
    db.prepare('DELETE FROM login_tokens WHERE id = ?').run(old.id)
  }
  return token
}

/** Valida el token, crea sesión persistente nueva (cookie) y rota el token.
 *  Devuelve { user, newToken } o null si el token no es válido/expiró. */
export function restoreFromToken(db: DB, c: Context<AppEnv>, token: string | undefined): { user: UserRow; newToken: string } | null {
  if (!token) return null
  const row = db.prepare('SELECT * FROM login_tokens WHERE token_hash = ?').get(restoreTokenHash(token)) as { id: string; user_id: string; expires_at: number } | undefined
  if (!row || row.expires_at < Date.now()) return null
  const user = db.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, dismissed_notifs, created_at FROM users WHERE id = ?').get(row.user_id) as UserRow | undefined
  if (!user) return null
  const id = createSession(db, user.id, c.req.header('user-agent'), false, true)
  const mac = hmac(sessionSecret(db), id)
  setCookie(c, COOKIE_NAME, `${id}.${mac}`, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  })
  const newToken = crypto.randomBytes(32).toString('base64url')
  db.prepare('UPDATE login_tokens SET token_hash = ?, expires_at = ?, last_used_at = ? WHERE id = ?')
    .run(restoreTokenHash(newToken), Date.now() + RESTORE_TTL_MS, Date.now(), row.id)
  return { user, newToken }
}

/** Invalida el token de restauración de un dispositivo (logout). */
export function destroyRestoreToken(db: DB, token: string): void {
  if (!token) return
  db.prepare('DELETE FROM login_tokens WHERE token_hash = ?').run(restoreTokenHash(token))
}

/** Cambio de contraseña: verifica la actual con bcrypt antes de re-hashear. */
export async function changePassword(db: DB, userId: string, current: string, next: string, currentToken?: string): Promise<'error' | 'wrong-current' | 'ok'> {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined
  if (!user) return 'error'
  const ok = await bcrypt.compare(current, user.password_hash)
  if (!ok) return 'wrong-current'
  const hash = await bcrypt.hash(next, 10)
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId)
    db.prepare('DELETE FROM login_tokens WHERE user_id = ?').run(userId)
    if (currentToken !== undefined) db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, currentToken)
  })()
  return 'ok'
}

/** Destruye las sesiones de un usuario salvo la actual (cambio de contraseña). */
export function destroyOtherSessions(db: DB, userId: string, currentToken: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, currentToken)
}

/** Alta de usuario (admin): password inicial obligatoria (≥6 en la ruta). */
export async function createUser(db: DB, { username, password, phone, role }: { username: string; password: string; phone?: string | null; role?: string }): Promise<UserRow | null> {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string } | undefined
  if (existing) return null
  const hash = await bcrypt.hash(password, 10)
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO users (id, username, password_hash, phone, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, username, hash, phone || null, 'auto', role || 'user', Date.now())
  return db.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, created_at FROM users WHERE id = ?').get(id) as UserRow
}

export function updateLanguage(db: DB, userId: string, language: string): UserRow {
  db.prepare('UPDATE users SET language = ? WHERE id = ?').run(language, userId)
  return db.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, created_at FROM users WHERE id = ?').get(userId) as UserRow
}

/** Días de aviso del panel por usuario (1-30; 0 = defecto global). */
export function updateLookaheadDays(db: DB, userId: string, days: number): UserRow {
  db.prepare('UPDATE users SET lookahead_days = ? WHERE id = ?').run(days, userId)
  return db.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, created_at FROM users WHERE id = ?').get(userId) as UserRow
}

/** Reset de contraseña por un admin: re-hashea y destruye las sesiones del usuario. */
export async function setUserPassword(db: DB, userId: string, password: string): Promise<boolean> {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: string } | undefined
  if (!user) return false
  const hash = await bcrypt.hash(password, 10)
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM login_tokens WHERE user_id = ?').run(userId)
  })()
  return true
}

export function setUserRole(db: DB, userId: string, role: string): UserRow {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId)
  return db.prepare('SELECT id, username, email, phone, language, role, lookahead_days, display_name, avatar, created_at FROM users WHERE id = ?').get(userId) as UserRow
}

export function countAdmins(db: DB): number {
  return (db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get() as { n: number }).n
}

export function deleteUser(db: DB, userId: string): boolean {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  return db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0
}

export function cleanExpiredSessions(db: DB): void {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
}

export function cleanExpiredLoginAttempts(db: DB): void {
  const oneHourAgo = Date.now() - 3600 * 1000
  db.prepare('DELETE FROM login_attempts WHERE locked_until > 0 AND locked_until < ?').run(oneHourAgo)
}
