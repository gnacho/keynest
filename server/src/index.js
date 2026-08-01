import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import crypto from 'node:crypto'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { z } from 'zod'
import * as auth from './auth.js'
import { audit, openDb, kvGet, kvSet } from './db.js'
import { syncAll, syncStatus } from './sync.js'
import { fetchIcs, icsToReservations, parseIcs } from './ical.js'
import { seedDemo } from './seed-demo.js'
import { saveTedeeConfig, tedeeConfig, tedeeLocks } from './tedee.js'
import { applyUpdate, updateStatus } from './update.js'
import { importAirbnb, parseAirbnbCsv } from './import-airbnb.js'

const DEFAULT_CATEGORIES = [
  { key: 'cerradura/pilas', label: 'Cerradura/pilas', icon: 'lock' },
  { key: 'electricidad', label: 'Electricidad', icon: 'zap' },
  { key: 'fontanería', label: 'Fontanería', icon: 'droplets' },
  { key: 'climatización', label: 'Climatización', icon: 'thermometer' },
  { key: 'mobiliario', label: 'Mobiliario', icon: 'sofa' },
  { key: 'persianas', label: 'Persianas', icon: 'blinds' },
]

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8081),
  DATA_DIR: z.string().default('./data'),
  STATIC_DIR: z.string().default('../public'),
  AUTH_USER: z.string().min(1),
  AUTH_PASS: z.string().min(6),
  SYNC_INTERVAL_MS: z.coerce.number().int().min(60000).default(15 * 60 * 1000),
})
const env = envSchema.parse(process.env) // fail-fast si falta algo crítico
const config = {
  port: env.PORT,
  dataDir: env.DATA_DIR,
  staticDir: resolve(env.STATIC_DIR),
  authUser: env.AUTH_USER,
  authPass: env.AUTH_PASS,
  syncIntervalMs: env.SYNC_INTERVAL_MS,
}

const prodDb = openDb(config.dataDir, 'keynest.db')
const demoDb = openDb(config.dataDir, 'keynest_demo.db')
seedDemo(demoDb)
await auth.ensureBootstrapAdmin(prodDb, config)
auth.cleanExpiredSessions(prodDb)

const app = new Hono()

/* ---------------------------------------------------------- headers seguridad */
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'")
  await next()
})

/* ------------------------------------------------------------------ auth API */
const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1), remember: z.boolean().optional() })

app.post('/api/auth/login', async (c) => {
  if (auth.loginRateLimited(prodDb, c)) return c.json({ error: 'demasiados intentos, espera 5 minutos' }, 429)
  const body = await c.req.json().catch(() => null)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const user = await auth.handleLogin(prodDb, c, parsed.data)
  if (!user) {
    auth.registerLoginFail(prodDb, c)
    return c.json({ error: 'credenciales incorrectas' }, 401)
  }
  auth.loginOk(prodDb, c)
  return c.json({ ok: true, user })
})

/* Login demo (un clic, sin contraseña) + estado público del modo demo */
app.get('/api/auth/demo-status', (c) => c.json({ enabled: auth.demoEnabled(prodDb) }))

app.post('/api/auth/demo', (c) => {
  const user = auth.handleDemoLogin(prodDb, c)
  if (!user) return c.json({ error: 'modo demo desactivado' }, 403)
  return c.json({ ok: true, user })
})

app.post('/api/auth/logout', (c) => {
  auth.handleLogout(prodDb, c)
  return c.json({ ok: true })
})

app.get('/api/auth/me', (c) => {
  const user = auth.currentUser(prodDb, demoDb, c)
  if (!user) return c.json({ authenticated: false }, 401)
  return c.json({ authenticated: true, user })
})

const profileSchema = z.object({
  language: z.enum(['auto', 'es', 'en']).optional(),
  lookaheadDays: z.coerce.number().int().min(1).max(30).optional(),
})
app.put('/api/auth/profile', auth.requireAuth(prodDb, demoDb), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = profileSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const db = c.get('db')
  let user = c.get('user')
  if (parsed.data.language) user = auth.updateLanguage(db, user.id, parsed.data.language)
  if (parsed.data.lookaheadDays) user = auth.updateLookaheadDays(db, user.id, parsed.data.lookaheadDays)
  return c.json({ ok: true, user })
})

/* Cambio de contraseña (formulario app: actual + nueva ≥6) */
const passwordSchema = z.object({ current: z.string().min(1), next: z.string().min(6) })
app.put('/api/auth/password', auth.requireAuth(prodDb, demoDb), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = passwordSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido', code: 'format' }, 400)
  const res = await auth.changePassword(c.get('db'), c.get('user').id, parsed.data.current, parsed.data.next)
  if (res === 'wrong-current') return c.json({ error: 'contraseña actual incorrecta', code: 'wrong-current' }, 403)
  return c.json({ ok: true })
})

/* Alta de usuario gestión (solo admin, password inicial ≥6, rol user|admin) */
const newUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(6),
  phone: z.string().optional(),
  role: z.enum(['user', 'admin']).optional(),
})
app.post('/api/users', auth.requireAdmin(prodDb, demoDb), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = newUserSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido', code: 'format' }, 400)
  const user = await auth.createUser(prodDb, parsed.data)
  if (!user) return c.json({ error: 'el usuario ya existe', code: 'exists' }, 409)
  aud(c, 'create', 'user', user.id, user.username)
  return c.json({ ok: true, user }, 201)
})

/* Actualización de la app (solo admin): estado y aplicar */
app.get('/api/update/status', auth.requireAdmin(prodDb, demoDb), async (c) => {
  return c.json(await updateStatus(prodDb))
})

app.post('/api/update/apply', auth.requireAdmin(prodDb, demoDb), async (c) => {
  const ok = await applyUpdate()
  // systemd Restart=always levanta el servicio con el código nuevo tras salir
  setTimeout(() => process.exit(0), 1500)
  return c.json({ ok, restarting: ok })
})

/* Audit log (solo admin, últimas 100 entradas) */
app.get('/api/audit', auth.requireAdmin(prodDb, demoDb), (c) => {
  const rows = c.get('db').prepare('SELECT * FROM audit_log ORDER BY at DESC LIMIT 100').all()
  return c.json({ entries: rows })
})

/* Lista de usuarios (solo admin) */
app.get('/api/users', auth.requireAdmin(prodDb, demoDb), (c) => {
  const users = prodDb.prepare('SELECT id, username, email, phone, language, role, lookahead_days, created_at FROM users ORDER BY created_at').all()
  return c.json({ users })
})

/* Reset de contraseña por admin: destruye las sesiones del usuario */
const resetPwdSchema = z.object({ password: z.string().min(6) })
app.put('/api/users/:id/password', auth.requireAdmin(prodDb, demoDb), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = resetPwdSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido', code: 'format' }, 400)
  const ok = await auth.setUserPassword(prodDb, c.req.param('id'), parsed.data.password)
  if (!ok) return c.json({ error: 'usuario no encontrado' }, 404)
  aud(c, 'update', 'user', c.req.param('id'), 'password reset')
  return c.json({ ok: true })
})

/* Cambio de rol (admin): prohibido sobre uno mismo, protege el último admin */
const roleSchema = z.object({ role: z.enum(['user', 'admin']) })
app.put('/api/users/:id/role', auth.requireAdmin(prodDb, demoDb), async (c) => {
  const targetId = c.req.param('id')
  if (targetId === c.get('user').id) return c.json({ error: 'no puedes cambiar tu propio rol', code: 'self' }, 403)
  const body = await c.req.json().catch(() => null)
  const parsed = roleSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido', code: 'format' }, 400)
  const target = prodDb.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId)
  if (!target) return c.json({ error: 'usuario no encontrado' }, 404)
  if (target.role === 'admin' && parsed.data.role === 'user' && auth.countAdmins(prodDb) <= 1) {
    return c.json({ error: 'debe quedar al menos un administrador', code: 'last-admin' }, 409)
  }
  const user = auth.setUserRole(prodDb, targetId, parsed.data.role)
  aud(c, 'update', 'user', targetId, `role=${parsed.data.role}`)
  return c.json({ ok: true, user })
})

/* Cambio de idioma (admin sobre cualquier usuario) */
const userLangSchema = z.object({ language: z.enum(['auto', 'es', 'en']) })
app.put('/api/users/:id/language', auth.requireAdmin(prodDb, demoDb), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = userLangSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido', code: 'format' }, 400)
  const user = auth.updateLanguage(prodDb, c.req.param('id'), parsed.data.language)
  if (!user) return c.json({ error: 'usuario no encontrado' }, 404)
  return c.json({ ok: true, user })
})

/* Borrado de usuario (admin): prohibido sobre uno mismo, protege el último admin, borra sus sesiones */
app.delete('/api/users/:id', auth.requireAdmin(prodDb, demoDb), (c) => {
  const targetId = c.req.param('id')
  if (targetId === c.get('user').id) return c.json({ error: 'no puedes eliminarte a ti mismo', code: 'self' }, 403)
  const target = prodDb.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId)
  if (!target) return c.json({ error: 'usuario no encontrado' }, 404)
  if (target.role === 'admin' && auth.countAdmins(prodDb) <= 1) {
    return c.json({ error: 'debe quedar al menos un administrador', code: 'last-admin' }, 409)
  }
  auth.deleteUser(prodDb, targetId)
  aud(c, 'delete', 'user', targetId, target.username)
  return c.json({ ok: true })
})

/* Importar CSV "Historial de transacciones" de Airbnb (solo admin).
 * dry=true (defecto) = vista previa; dry=false = aplica (idempotente).
 * map: { nombreListing: propertyId } — vive en la petición, no en el repo. */
const importSchema = z.object({
  csv: z.string().min(1).max(5 * 1024 * 1024),
  dry: z.boolean().default(true),
  map: z.record(z.string(), z.string()).default({}),
})
app.post('/api/import/airbnb', auth.requireAdmin(prodDb, demoDb), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = importSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido', code: 'format' }, 400)
  const { reservations, dupes, skipped, error } = parseAirbnbCsv(parsed.data.csv)
  if (error) return c.json({ error, code: 'csv' }, 400)
  const result = importAirbnb(prodDb, reservations, parsed.data.map, parsed.data.dry)
  if (!parsed.data.dry) aud(c, 'import', 'reservation', '', `airbnb csv: ${result.updated} act, ${result.inserted} nuevas`)
  return c.json({ ...result, dupes, skipped, total: reservations.length, dry: parsed.data.dry })
})

/* Config Tedee (solo admin): bridge local + token */
app.get('/api/config/tedee', auth.requireAdmin(prodDb, demoDb), (c) => {
  const { url, token } = tedeeConfig(prodDb)
  return c.json({ url, hasToken: Boolean(token) })
})

const tedeeSchema = z.object({ url: z.string().url().or(z.literal('')), token: z.string().optional() })
app.put('/api/config/tedee', auth.requireAdmin(prodDb, demoDb), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = tedeeSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  saveTedeeConfig(prodDb, parsed.data.url, parsed.data.token || '')
  return c.json({ ok: true })
})

/* Test de conexión con el bridge + lista de cerraduras */
app.get('/api/tedee/test', auth.requireAuth(prodDb, demoDb), async (c) => {
  try {
    const locks = await tedeeLocks(prodDb)
    return c.json({ ok: true, locks })
  } catch (err) {
    const code = err.message === 'not-configured' ? 'not-configured' : err.message.startsWith('http-') ? err.message : 'fetch'
    return c.json({ ok: false, code })
  }
})

/* Toggle modo demo (solo admin de producción) */
const demoSchema = z.object({ enabled: z.boolean() })
app.put('/api/config/demo', auth.requireAdmin(prodDb, demoDb), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = demoSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  kvSet(prodDb, 'demo_enabled', parsed.data.enabled ? '1' : '0')
  return c.json({ ok: true, enabled: parsed.data.enabled })
})

/* ------------------------------------------------------------------ data API */
const guarded = new Hono()
guarded.use('*', auth.requireAuth(prodDb, demoDb))

guarded.get('/bootstrap', (c) => {
  const db = c.get('db')
  const properties = db.prepare('SELECT * FROM properties ORDER BY created_at').all()
    .map((p) => ({ ...p, checklist: JSON.parse(p.checklist || '[]') }))
  const reservations = db.prepare('SELECT * FROM reservations ORDER BY checkin').all()
  const cleanings = db.prepare('SELECT * FROM cleanings ORDER BY date').all()
    .map((cl) => {
      // Limpiezas antiguas sin checks: heredan el checklist actual del inmueble
      if (JSON.parse(cl.checks || '[]').length === 0) {
        const prop = properties.find((p) => p.id === cl.property_id)
        if (prop) cl.checks = JSON.stringify(prop.checklist.map((label, i) => ({ id: `chk-${i}`, label, done: false })))
      }
      return cl
    })
  const maintenance = db.prepare('SELECT * FROM maintenance_tasks ORDER BY created_at DESC').all()
    .map((t) => ({ ...t, has_token: Boolean(t.token_hash), token_hash: undefined }))
  const people = db.prepare('SELECT id, name, phone, role, specialty, hourly_rate, token_hash, created_at FROM people ORDER BY created_at').all()
    .map((p) => ({ ...p, has_token: Boolean(p.token_hash), token_hash: undefined }))
  let categories = kvGet(db, 'maint_categories')
  if (!categories) categories = JSON.stringify(DEFAULT_CATEGORIES)
  const settings = {
    checkInTime: kvGet(db, 'set_checkin') || '15:00',
    checkOutTime: kvGet(db, 'set_checkout') || '11:00',
    batteryThreshold: Number(kvGet(db, 'set_battery') || 30),
    autoCleaning: kvGet(db, 'set_autoclean') !== '0',
    // Días de aviso del panel: preferencia POR USUARIO (0 = defecto global)
    lookaheadDays: c.get('user').lookahead_days || Number(kvGet(db, 'set_lookahead') || 7),
  }
  return c.json({ properties, reservations, cleanings, maintenance, people, categories: JSON.parse(categories), config: { ...settings }, sync: syncStatus(db), demo: c.get('user').is_demo, demoEnabled: auth.demoEnabled(prodDb) })
})

const propertySchema = z.object({
  name: z.string().min(1),
  address: z.string().default(''),
  bedrooms: z.coerce.number().int().min(0).default(1),
  bathrooms: z.coerce.number().int().min(0).default(1),
  area: z.coerce.number().int().min(0).default(0),
  photo: z.string().default('/prop-carmen.svg'),
  icalUrl: z.string().default(''),
  checklist: z.array(z.string()).default([]),
  instructions: z.string().default(''),
})

function slugify(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'inmueble'
}

const aud = (c, action, entity, entityId, detail = '') => audit(c.get('db'), c.get('user')?.id, action, entity, entityId, detail)

guarded.post('/properties', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = propertySchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data
  let slug = slugify(d.name)
  let n = 2
  const db = c.get('db')
  while (db.prepare('SELECT id FROM properties WHERE slug = ?').get(slug)) slug = `${slugify(d.name)}-${n++}`
  const id = crypto.randomUUID()
  c.get('db').prepare(`INSERT INTO properties (id, slug, name, address, bedrooms, bathrooms, area, photo, ical_url, checklist, instructions, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, slug, d.name, d.address, d.bedrooms, d.bathrooms, d.area, d.photo, d.icalUrl, JSON.stringify(d.checklist), d.instructions, Date.now())
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(id)
  aud(c, 'create', 'property', id, d.name)
  return c.json({ ok: true, property: { ...property, checklist: JSON.parse(property.checklist) } }, 201)
})

guarded.put('/properties/:id', async (c) => {
  const db = c.get('db')
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(c.req.param('id'))
  if (!existing) return c.json({ error: 'no encontrado' }, 404)
  const body = await c.req.json().catch(() => null)
  const parsed = propertySchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data
  db.prepare(`UPDATE properties SET name=?, address=?, bedrooms=?, bathrooms=?, area=?, photo=?, ical_url=?, checklist=?, instructions=? WHERE id=?`)
    .run(d.name, d.address, d.bedrooms, d.bathrooms, d.area, d.photo, d.icalUrl, JSON.stringify(d.checklist), d.instructions, existing.id)
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(existing.id)
  aud(c, 'update', 'property', existing.id, d.name)
  return c.json({ ok: true, property: { ...property, checklist: JSON.parse(property.checklist) } })
})

/* Validador de URL iCal: descarga y comprueba que sea un calendario usable.
   Devuelve códigos de error para que el frontend los traduzca. */
const icalSchema = z.object({ url: z.string().url() })
guarded.post('/ical/validate', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = icalSchema.safeParse(body)
  if (!parsed.success) return c.json({ ok: false, code: 'url' })
  try {
    const res = await fetch(parsed.data.url, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
    if (!res.ok) return c.json({ ok: false, code: 'http', status: res.status })
    const text = await res.text()
    if (!text.includes('BEGIN:VCALENDAR')) return c.json({ ok: false, code: 'not-ics' })
    const events = parseIcs(text)
    const reservations = icsToReservations(events)
    if (events.length === 0) return c.json({ ok: false, code: 'empty' })
    return c.json({ ok: true, count: reservations.length })
  } catch {
    return c.json({ ok: false, code: 'fetch' })
  }
})

/* Crear limpieza. Sin límite de antelación (el margen solo rige los avisos del
   panel). Fecha ocupada = aviso NO bloqueante: 409 'occupied' salvo force=true. */
const cleaningSchema = z.object({
  propertyId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reservationId: z.string().optional(),
  force: z.boolean().optional(),
})
guarded.post('/cleanings', async (c) => {
  const db = c.get('db')
  const body = await c.req.json().catch(() => null)
  const parsed = cleaningSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(d.propertyId)
  if (!property) return c.json({ error: 'inmueble no encontrado' }, 404)

  if (d.reservationId) {
    const dup = db.prepare('SELECT * FROM cleanings WHERE reservation_id = ?').get(d.reservationId)
    if (dup) return c.json({ ok: true, cleaning: dup, existing: true })
  }
  // Sin límite de antelación: el margen de días solo aplica a avisos del panel.
  // Fecha ocupada = aviso NO bloqueante: 409 'occupied' salvo que venga force=true
  // (la UI muestra el doble aviso y reintenta con force).
  // Ocupación estricta: entrada y salida SÍ están permitidas (por eso < y > estrictos)
  const occupied = db.prepare(
    "SELECT uid FROM reservations WHERE property_id = ? AND checkin < ? AND checkout > ? LIMIT 1",
  ).get(d.propertyId, d.date, d.date)
  if (occupied && !d.force) return c.json({ error: 'fecha ocupada', code: 'occupied' }, 409)

  const checklist = JSON.parse(property.checklist || '[]')
  const checks = checklist.map((label, i) => ({ id: `chk-${i}`, label, done: false }))
  const id = crypto.randomUUID()
  db.prepare(`INSERT INTO cleanings (id, property_id, reservation_id, date, status, assignee_ids, estimated_hours, checks, photos, created_at)
              VALUES (?, ?, ?, ?, 'pendiente', '[]', 2, ?, '[]', ?)`)
    .run(id, d.propertyId, d.reservationId ?? null, d.date, JSON.stringify(checks), Date.now())
  const cleaning = db.prepare('SELECT * FROM cleanings WHERE id = ?').get(id)
  aud(c, 'create', 'cleaning', id, `${d.propertyId} ${d.date}`)
  return c.json({ ok: true, cleaning }, 201)
})

/* Importe manual + notas de una reserva (iCal no trae importes) */
const resUpdateSchema = z.object({
  amount: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
})
guarded.put('/reservations/:id', async (c) => {
  const db = c.get('db')
  const existing = db.prepare('SELECT id FROM reservations WHERE id = ?').get(c.req.param('id'))
  if (!existing) return c.json({ error: 'no encontrada' }, 404)
  const body = await c.req.json().catch(() => null)
  const parsed = resUpdateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data
  db.prepare('UPDATE reservations SET amount = COALESCE(?, amount), notes = COALESCE(?, notes) WHERE id = ?')
    .run(d.amount ?? null, d.notes ?? null, existing.id)
  return c.json({ ok: true, reservation: db.prepare('SELECT * FROM reservations WHERE id = ?').get(existing.id) })
})

/* --------------------------------------------------- Tareas de mantenimiento */
const checkSchema = z.object({ id: z.string(), label: z.string(), done: z.boolean() })
const maintSchema = z.object({
  propertyId: z.string().min(1),
  title: z.string().min(1),
  category: z.string().default(''),
  expenseTag: z.string().default(''),
  urgent: z.boolean().default(false),
  notes: z.string().default(''),
  checks: z.array(checkSchema).optional(),
})
guarded.post('/maintenance', async (c) => {
  const db = c.get('db')
  const body = await c.req.json().catch(() => null)
  const parsed = maintSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data
  if (!db.prepare('SELECT id FROM properties WHERE id = ?').get(d.propertyId)) return c.json({ error: 'inmueble no encontrado' }, 404)
  const id = crypto.randomUUID()
  db.prepare(`INSERT INTO maintenance_tasks (id, property_id, title, category, expense_tag, urgent, notes, status, checks, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'nueva', ?, ?)`)
    .run(id, d.propertyId, d.title, d.category, d.expenseTag, d.urgent ? 1 : 0, d.notes, JSON.stringify(d.checks ?? []), Date.now())
  aud(c, 'create', 'maintenance', id, d.title)
  return c.json({ ok: true, task: db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(id) }, 201)
})

const maintUpdateSchema = z.object({
  status: z.enum(['nueva', 'asignada', 'finalizada']).optional(),
  assigneeId: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
  title: z.string().min(1).optional(),
  category: z.string().optional(),
  expenseTag: z.string().optional(),
  urgent: z.boolean().optional(),
  notes: z.string().optional(),
  scheduledDate: z.string().nullable().optional(),
  checks: z.array(checkSchema).optional(),
})
guarded.put('/maintenance/:id', async (c) => {
  const db = c.get('db')
  const existing = db.prepare('SELECT id FROM maintenance_tasks WHERE id = ?').get(c.req.param('id'))
  if (!existing) return c.json({ error: 'no encontrada' }, 404)
  const body = await c.req.json().catch(() => null)
  const parsed = maintUpdateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data
  db.prepare(`UPDATE maintenance_tasks SET
    status = COALESCE(?, status),
    assignee_id = CASE WHEN ? THEN ? ELSE assignee_id END,
    cost = COALESCE(?, cost),
    title = COALESCE(?, title),
    category = COALESCE(?, category),
    expense_tag = COALESCE(?, expense_tag),
    urgent = COALESCE(?, urgent),
    notes = COALESCE(?, notes),
    scheduled_date = CASE WHEN ? THEN ? ELSE scheduled_date END,
    checks = COALESCE(?, checks)
    WHERE id = ?`)
    .run(
      d.status ?? null,
      d.assigneeId !== undefined ? 1 : 0,
      d.assigneeId ?? null,
      d.cost ?? null,
      d.title ?? null,
      d.category ?? null,
      d.expenseTag ?? null,
      d.urgent !== undefined ? (d.urgent ? 1 : 0) : null,
      d.notes ?? null,
      d.scheduledDate !== undefined ? 1 : 0,
      d.scheduledDate ?? null,
      d.checks !== undefined ? JSON.stringify(d.checks) : null,
      existing.id,
    )
  aud(c, 'update', 'maintenance', existing.id, JSON.stringify(Object.keys(d)))
  return c.json({ ok: true, task: db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(existing.id) })
})

/* Token POR ORDEN de trabajo (proveedores): enlace a la vista pública de ESA orden.
   Solo el hash en BD; el plano se devuelve una vez. */
guarded.post('/maintenance/:id/token', (c) => {
  const db = c.get('db')
  const task = db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(c.req.param('id'))
  if (!task) return c.json({ error: 'no encontrada' }, 404)
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const rand = Array.from(crypto.randomBytes(16), (b) => alphabet[b % alphabet.length]).join('')
  const token = `kn-wo-${rand}`
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  db.prepare('UPDATE maintenance_tasks SET token_hash = ? WHERE id = ?').run(hash, task.id)
  aud(c, 'update', 'maintenance', task.id, 'token creado')
  return c.json({ ok: true, token, path: `/t/${token}` })
})

guarded.delete('/maintenance/:id/token', (c) => {
  const db = c.get('db')
  db.prepare('UPDATE maintenance_tasks SET token_hash = NULL WHERE id = ?').run(c.req.param('id'))
  aud(c, 'update', 'maintenance', c.req.param('id'), 'token revocado')
  return c.json({ ok: true })
})

/* ---------------------------------------------------------- Personas (staff) */
const personSchema = z.object({
  name: z.string().min(1),
  phone: z.string().default(''),
  role: z.enum(['limpieza', 'proveedor']),
  specialty: z.string().default(''),
  hourlyRate: z.coerce.number().min(0).default(10),
})

guarded.post('/people', async (c) => {
  const db = c.get('db')
  const body = await c.req.json().catch(() => null)
  const parsed = personSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO people (id, name, phone, role, specialty, hourly_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, d.name, d.phone, d.role, d.specialty, d.hourlyRate, Date.now())
  const person = db.prepare('SELECT id, name, phone, role, specialty, hourly_rate, created_at FROM people WHERE id = ?').get(id)
  aud(c, 'create', 'person', id, d.name)
  return c.json({ ok: true, person: { ...person, has_token: false } }, 201)
})

guarded.put('/people/:id', async (c) => {
  const db = c.get('db')
  const existing = db.prepare('SELECT id FROM people WHERE id = ?').get(c.req.param('id'))
  if (!existing) return c.json({ error: 'no encontrada' }, 404)
  const body = await c.req.json().catch(() => null)
  const parsed = personSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data
  db.prepare('UPDATE people SET name=?, phone=?, role=?, specialty=?, hourly_rate=? WHERE id=?')
    .run(d.name, d.phone, d.role, d.specialty, d.hourlyRate, existing.id)
  const person = db.prepare('SELECT id, name, phone, role, specialty, hourly_rate, token_hash, created_at FROM people WHERE id = ?').get(existing.id)
  aud(c, 'update', 'person', existing.id, d.name)
  return c.json({ ok: true, person: { ...person, has_token: Boolean(person.token_hash), token_hash: undefined } })
})

guarded.delete('/people/:id', (c) => {
  const db = c.get('db')
  db.prepare('DELETE FROM people WHERE id = ?').run(c.req.param('id'))
  aud(c, 'delete', 'person', c.req.param('id'))
  return c.json({ ok: true })
})

/* Token de acceso por enlace (capability URL): se guarda SOLO el hash; el plano se devuelve una vez.
   REGLA: solo personas de limpieza — los proveedores usan token POR ORDEN de trabajo. */
guarded.post('/people/:id/token', (c) => {
  const db = c.get('db')
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(c.req.param('id'))
  if (!person) return c.json({ error: 'no encontrada' }, 404)
  if (person.role !== 'limpieza') return c.json({ error: 'solo limpieza tiene enlace por persona', code: 'not-limpieza' }, 409)
  const slug = person.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g, '') || 'user'
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const rand = Array.from(crypto.randomBytes(16), (b) => alphabet[b % alphabet.length]).join('')
  const token = `kn-${slug}-${rand}`
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  db.prepare('UPDATE people SET token_hash = ? WHERE id = ?').run(hash, person.id)
  return c.json({ ok: true, token, path: `/t/${token}` })
})

guarded.delete('/people/:id/token', (c) => {
  const db = c.get('db')
  db.prepare('UPDATE people SET token_hash = NULL WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

/* Actualización de limpieza (asignación, estado, checks, fotos, confirmación) */
const cleaningUpdateSchema = z.object({
  status: z.enum(['pendiente', 'asignada', 'en-curso', 'archivada']).optional(),
  assigneeIds: z.array(z.string()).max(2).optional(),
  estimatedHours: z.coerce.number().min(0).optional(),
  checks: z.array(z.object({ id: z.string(), label: z.string(), done: z.boolean() })).optional(),
  photos: z.array(z.string()).optional(),
  workLog: z.array(z.object({ personId: z.string(), hours: z.number() })).optional(),
  supplies: z.array(z.object({ label: z.string(), amount: z.number() })).optional(),
})
guarded.put('/cleanings/:id', async (c) => {
  const db = c.get('db')
  const existing = db.prepare('SELECT * FROM cleanings WHERE id = ?').get(c.req.param('id'))
  if (!existing) return c.json({ error: 'no encontrada' }, 404)
  const body = await c.req.json().catch(() => null)
  const parsed = cleaningUpdateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data
  const materials = d.supplies ? d.supplies.reduce((a, s) => a + s.amount, 0) : undefined
  db.prepare(`UPDATE cleanings SET
    status = COALESCE(?, status),
    assignee_ids = COALESCE(?, assignee_ids),
    estimated_hours = COALESCE(?, estimated_hours),
    checks = COALESCE(?, checks),
    photos = COALESCE(?, photos),
    work_log = COALESCE(?, work_log),
    supplies = COALESCE(?, supplies),
    materials = COALESCE(?, materials)
    WHERE id = ?`)
    .run(
      d.status ?? null,
      d.assigneeIds ? JSON.stringify(d.assigneeIds) : null,
      d.estimatedHours ?? null,
      d.checks ? JSON.stringify(d.checks) : null,
      d.photos ? JSON.stringify(d.photos) : null,
      d.workLog ? JSON.stringify(d.workLog) : null,
      d.supplies ? JSON.stringify(d.supplies) : null,
      materials ?? null,
      existing.id,
    )
  const cleaning = db.prepare('SELECT * FROM cleanings WHERE id = ?').get(existing.id)
  aud(c, 'update', 'cleaning', existing.id, JSON.stringify(Object.keys(d)))
  return c.json({ ok: true, cleaning })
})

/* Preferencias de la app (admin): horarios, umbral batería, limpieza automática */
const settingsSchema = z.object({
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  checkOutTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  batteryThreshold: z.coerce.number().int().min(5).max(90).optional(),
  autoCleaning: z.boolean().optional(),
  lookaheadDays: z.coerce.number().int().min(1).max(30).optional(),
})
guarded.put('/config/settings', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'solo admin' }, 403)
  const body = await c.req.json().catch(() => null)
  const parsed = settingsSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const db = c.get('db')
  const d = parsed.data
  if (d.checkInTime) kvSet(db, 'set_checkin', d.checkInTime)
  if (d.checkOutTime) kvSet(db, 'set_checkout', d.checkOutTime)
  if (d.batteryThreshold !== undefined) kvSet(db, 'set_battery', String(d.batteryThreshold))
  if (d.autoCleaning !== undefined) kvSet(db, 'set_autoclean', d.autoCleaning ? '1' : '0')
  if (d.lookaheadDays !== undefined) kvSet(db, 'set_lookahead', String(d.lookaheadDays))
  return c.json({ ok: true })
})

/* Maestro de categorías de mantenimiento */
const categoriesSchema = z.object({
  categories: z.array(z.object({ key: z.string().min(1), label: z.string().min(1), icon: z.string().default('wrench') })).min(1),
})
guarded.put('/config/categories', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'solo admin' }, 403)
  const body = await c.req.json().catch(() => null)
  const parsed = categoriesSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  kvSet(c.get('db'), 'maint_categories', JSON.stringify(parsed.data.categories))
  return c.json({ ok: true })
})

/* ------------------------------------------- API pública por token (personal) */
function personByToken(db, token) {
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  return db.prepare('SELECT id, name, phone, role, specialty, hourly_rate FROM people WHERE token_hash = ?').get(hash)
}

function taskByToken(db, token) {
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  return db.prepare('SELECT * FROM maintenance_tasks WHERE token_hash = ?').get(hash)
}

app.get('/api/t/:token', (c) => {
  const person = personByToken(prodDb, c.req.param('token'))
  if (person) {
    const props = prodDb.prepare('SELECT * FROM properties').all()
      .map((p) => ({ id: p.id, name: p.name, address: p.address, photo: p.photo, instructions: p.instructions, checklist: JSON.parse(p.checklist || '[]') }))
    const cleanings = prodDb.prepare(
      `SELECT * FROM cleanings
       WHERE status != 'archivada'
         AND EXISTS (SELECT 1 FROM json_each(assignee_ids) WHERE value = ?)
       ORDER BY date`,
    ).all(person.id)
      .map((cl) => {
        if (JSON.parse(cl.checks || '[]').length === 0) {
          const prop = props.find((p) => p.id === cl.property_id)
          if (prop) cl.checks = JSON.stringify(prop.checklist.map((label, i) => ({ id: `chk-${i}`, label, done: false })))
        }
        return cl
      })
    return c.json({ type: 'person', person, cleanings, properties: props })
  }
  // Token POR ORDEN de trabajo (proveedor): la orden + su inmueble + su asignado
  const task = taskByToken(prodDb, c.req.param('token'))
  if (!task) return c.json({ error: 'enlace no válido' }, 404)
  const prop = prodDb.prepare('SELECT id, name, address, photo, instructions FROM properties WHERE id = ?').get(task.property_id)
  const assignee = task.assignee_id
    ? prodDb.prepare('SELECT id, name, phone, specialty, hourly_rate FROM people WHERE id = ?').get(task.assignee_id)
    : null
  return c.json({
    type: 'workorder',
    task: { ...task, checks: JSON.parse(task.checks || '[]'), photos: JSON.parse(task.photos || '[]'), token_hash: undefined },
    property: prop,
    assignee,
  })
})

/* Acciones del proveedor sobre la orden (checks / fotos / finalizar) */
const woActionSchema = z.object({
  action: z.enum(['toggle-check', 'complete', 'reopen']),
  checkId: z.string().optional(),
  cost: z.number().nullable().optional(),
  notes: z.string().optional(),
})
app.post('/api/t/:token/task', async (c) => {
  const task = taskByToken(prodDb, c.req.param('token'))
  if (!task) return c.json({ error: 'enlace no válido' }, 404)
  const body = await c.req.json().catch(() => null)
  const parsed = woActionSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data
  if (d.action === 'toggle-check') {
    const checks = JSON.parse(task.checks || '[]')
    const k = checks.find((x) => x.id === d.checkId)
    if (k) k.done = !k.done
    prodDb.prepare('UPDATE maintenance_tasks SET checks = ? WHERE id = ?').run(JSON.stringify(checks), task.id)
  } else if (d.action === 'complete') {
    const checks = JSON.parse(task.checks || '[]').map((k) => ({ ...k, done: true }))
    prodDb.prepare("UPDATE maintenance_tasks SET status = 'finalizada', cost = COALESCE(?, cost), notes = COALESCE(?, notes), checks = ? WHERE id = ?")
      .run(d.cost ?? null, d.notes ?? null, JSON.stringify(checks), task.id)
  } else if (d.action === 'reopen') {
    prodDb.prepare("UPDATE maintenance_tasks SET status = 'asignada' WHERE id = ?").run(task.id)
  }
  const updated = prodDb.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(task.id)
  return c.json({ ok: true, task: { ...updated, checks: JSON.parse(updated.checks || '[]'), photos: JSON.parse(updated.photos || '[]'), token_hash: undefined } })
})

app.post('/api/t/:token/task/photo', async (c) => {
  const task = taskByToken(prodDb, c.req.param('token'))
  if (!task) return c.json({ error: 'enlace no válido' }, 404)
  const body = await c.req.parseBody().catch(() => null)
  const file = body?.photo
  if (!file || !(file instanceof File)) return c.json({ error: 'falta el fichero (campo photo)' }, 400)
  const ext = PHOTO_MIME[file.type]
  if (!ext) return c.json({ error: 'formato' }, 400)
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'grande' }, 400)
  const photosDir = join(config.dataDir, 'photos')
  mkdirSync(photosDir, { recursive: true })
  const filename = `maint-${task.id}-${Date.now()}.${ext}`
  writeFileSync(join(photosDir, filename), Buffer.from(await file.arrayBuffer()))
  const photos = JSON.parse(task.photos || '[]')
  photos.push(`/photos/${filename}`)
  prodDb.prepare('UPDATE maintenance_tasks SET photos = ? WHERE id = ?').run(JSON.stringify(photos), task.id)
  const updated = prodDb.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(task.id)
  return c.json({ ok: true, task: { ...updated, checks: JSON.parse(updated.checks || '[]'), photos: JSON.parse(updated.photos || '[]'), token_hash: undefined } })
})

app.post('/api/t/:token/cleanings/:id/photo', async (c) => {
  const person = personByToken(prodDb, c.req.param('token'))
  if (!person) return c.json({ error: 'enlace no válido' }, 404)
  const cl = prodDb.prepare('SELECT * FROM cleanings WHERE id = ?').get(c.req.param('id'))
  if (!cl) return c.json({ error: 'no encontrada' }, 404)
  const assigned = prodDb.prepare(
    'SELECT 1 ok FROM json_each((SELECT assignee_ids FROM cleanings WHERE id = ?)) WHERE value = ?',
  ).get(cl.id, person.id)
  if (!assigned) return c.json({ error: 'no asignada' }, 403)
  const body = await c.req.parseBody().catch(() => null)
  const file = body?.photo
  if (!file || !(file instanceof File)) return c.json({ error: 'falta el fichero (campo photo)' }, 400)
  const res = await saveCleaningPhoto(prodDb, cl.id, file)
  if (res.error) return c.json({ error: res.error }, res.status)
  return c.json({ ok: true, cleaning: res.cleaning })
})

const tokenActionSchema = z.object({
  action: z.enum(['toggle-check', 'complete']),
  checkId: z.string().optional(),
  workLog: z.array(z.object({ personId: z.string(), hours: z.number() })).optional(),
  supplies: z.array(z.object({ label: z.string(), amount: z.number() })).optional(),
})
app.post('/api/t/:token/cleanings/:id', async (c) => {
  const person = personByToken(prodDb, c.req.param('token'))
  if (!person) return c.json({ error: 'enlace no válido' }, 404)
  const cl = prodDb.prepare('SELECT * FROM cleanings WHERE id = ?').get(c.req.param('id'))
  if (!cl) return c.json({ error: 'no encontrada' }, 404)
  if (!JSON.parse(cl.assignee_ids || '[]').includes(person.id)) return c.json({ error: 'no asignada' }, 403)
  const body = await c.req.json().catch(() => null)
  const parsed = tokenActionSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'formato inválido' }, 400)
  const d = parsed.data

  if (d.action === 'toggle-check') {
    let checks = JSON.parse(cl.checks || '[]')
    // Limpiezas antiguas con checks vacíos: hidratar del checklist del inmueble ANTES de tocar
    if (checks.length === 0) {
      const prop = prodDb.prepare('SELECT checklist FROM properties WHERE id = ?').get(cl.property_id)
      checks = JSON.parse(prop?.checklist || '[]').map((label, i) => ({ id: `chk-${i}`, label, done: false }))
    }
    const k = checks.find((x) => x.id === d.checkId)
    if (k) k.done = !k.done
    prodDb.prepare('UPDATE cleanings SET checks = ? WHERE id = ?').run(JSON.stringify(checks), cl.id)
  } else if (d.action === 'complete') {
    const supplies = d.supplies ?? []
    const materials = supplies.reduce((a, s) => a + s.amount, 0)
    const checks = JSON.parse(cl.checks || '[]').map((k) => ({ ...k, done: true }))
    prodDb.prepare("UPDATE cleanings SET status = 'archivada', work_log = ?, supplies = ?, materials = ?, checks = ? WHERE id = ?")
      .run(JSON.stringify(d.workLog ?? []), JSON.stringify(supplies), materials, JSON.stringify(checks), cl.id)
  }
  const updated = prodDb.prepare('SELECT * FROM cleanings WHERE id = ?').get(cl.id)
  return c.json({ ok: true, cleaning: updated })
})

const PHOTO_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/* Subida de foto de limpieza: guarda fichero y lo añade a cleaning.photos */
async function saveCleaningPhoto(db, cleaningId, file) {
  const cl = db.prepare('SELECT * FROM cleanings WHERE id = ?').get(cleaningId)
  if (!cl) return { error: 'no encontrada', status: 404 }
  const ext = PHOTO_MIME[file.type]
  if (!ext) return { error: 'formato', status: 400 }
  if (file.size > 10 * 1024 * 1024) return { error: 'grande', status: 400 }
  const photosDir = join(config.dataDir, 'photos')
  mkdirSync(photosDir, { recursive: true })
  const filename = `clean-${cleaningId}-${Date.now()}.${ext}`
  writeFileSync(join(photosDir, filename), Buffer.from(await file.arrayBuffer()))
  const photos = JSON.parse(cl.photos || '[]')
  photos.push(`/photos/${filename}`)
  db.prepare('UPDATE cleanings SET photos = ? WHERE id = ?').run(JSON.stringify(photos), cleaningId)
  return { cleaning: db.prepare('SELECT * FROM cleanings WHERE id = ?').get(cleaningId) }
}

guarded.post('/cleanings/:id/photo', async (c) => {
  const db = c.get('db')
  const body = await c.req.parseBody().catch(() => null)
  const file = body?.photo
  if (!file || !(file instanceof File)) return c.json({ error: 'falta el fichero (campo photo)' }, 400)
  const res = await saveCleaningPhoto(db, c.req.param('id'), file)
  if (res.error) return c.json({ error: res.error }, res.status)
  return c.json({ ok: true, cleaning: res.cleaning })
})

/* Subida de foto del inmueble (multipart, campo 'photo', máx 10 MB) */
guarded.post('/properties/:id/photo', async (c) => {
  const db = c.get('db')
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(c.req.param('id'))
  if (!existing) return c.json({ error: 'no encontrado' }, 404)
  const body = await c.req.parseBody().catch(() => null)
  const file = body?.photo
  if (!file || !(file instanceof File)) return c.json({ error: 'falta el fichero (campo photo)' }, 400)
  const ext = PHOTO_MIME[file.type]
  if (!ext) return c.json({ error: 'formato' }, 400)
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'grande' }, 400)

  const photosDir = join(config.dataDir, 'photos')
  mkdirSync(photosDir, { recursive: true })
  const filename = `${existing.id}-${Date.now()}.${ext}`
  writeFileSync(join(photosDir, filename), Buffer.from(await file.arrayBuffer()))

  // Borra la foto anterior si era nuestra (/photos/...)
  if (existing.photo?.startsWith('/photos/')) {
    try { unlinkSync(join(photosDir, existing.photo.replace('/photos/', ''))) } catch { /* noop */ }
  }
  const photoPath = `/photos/${filename}`
  db.prepare('UPDATE properties SET photo = ? WHERE id = ?').run(photoPath, existing.id)
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(existing.id)
  aud(c, 'update', 'property', existing.id, d.name)
  return c.json({ ok: true, property: { ...property, checklist: JSON.parse(property.checklist) } })
})

let syncing = false
guarded.post('/sync', async (c) => {
  if (c.get('user').is_demo) return c.json({ ok: true, results: [] })
  if (syncing) return c.json({ error: 'ya hay una sincronización en curso' }, 409)
  syncing = true
  try {
    const results = await syncAll(prodDb)
    return c.json({ ok: true, results })
  } finally {
    syncing = false
  }
})

guarded.get('/sync/status', (c) => c.json(syncStatus(c.get('db'))))

app.route('/api', guarded)

app.get('/health', (c) => {
  const dbOk = prodDb.prepare('SELECT 1').get() ? 'connected' : 'error'
  return c.json({ status: dbOk === 'connected' ? 'ok' : 'degraded', uptime: process.uptime(), db: dbOk })
})

/* ------------------------------------------------------------- estático SPA */
app.use('/assets/*', serveStatic({ root: config.staticDir }))
app.use('/photos/*', serveStatic({ root: config.dataDir }))
app.use('/*', serveStatic({ root: config.staticDir }))
// index.html se lee EN CADA PETICIÓN: tras un deploy (rsync/tar) no hace falta reiniciar
app.get('*', (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'no encontrado' }, 404)
  try {
    const html = readFileSync(join(config.staticDir, 'index.html'), 'utf8')
    return c.html(html)
  } catch {
    return c.text('frontend no desplegado', 503)
  }
})

/* ------------------------------------------------------------------- jobs */
const runSync = () => syncAll(prodDb).catch((e) => console.error('[sync] error job:', e.message))
setTimeout(runSync, 5000) // sync inicial al arrancar
setInterval(runSync, config.syncIntervalMs)
setInterval(() => auth.cleanExpiredSessions(prodDb), 3600 * 1000)
setInterval(() => {
  try { prodDb.pragma('wal_checkpoint(TRUNCATE)'); demoDb.pragma('wal_checkpoint(TRUNCATE)') } catch { /* noop */ }
}, 3600 * 1000)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[keynest] escuchando en :${info.port} (static: ${config.staticDir}, data: ${config.dataDir})`)
})

process.on('SIGTERM', () => { prodDb.close(); demoDb.close(); process.exit(0) })
process.on('SIGINT', () => { prodDb.close(); demoDb.close(); process.exit(0) })
