import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Migraciones versionadas (patrón skill references/sqlite.md):
 * una versión por entrada, en transacción, registrada en schema_version.
 * NUNCA editar una ya aplicada — añadir una nueva al final.
 */
const MIGRATIONS = [
  // 1: bathrooms en properties
  `ALTER TABLE properties ADD COLUMN bathrooms INTEGER DEFAULT 1`,
  // 2: is_demo en sessions
  `ALTER TABLE sessions ADD COLUMN is_demo INTEGER DEFAULT 0`,
  // 3: work_log/supplies/materials en cleanings
  `ALTER TABLE cleanings ADD COLUMN work_log TEXT;
   ALTER TABLE cleanings ADD COLUMN supplies TEXT;
   ALTER TABLE cleanings ADD COLUMN materials REAL`,
  // 4: amount/notes en reservations
  `ALTER TABLE reservations ADD COLUMN amount REAL DEFAULT 0;
   ALTER TABLE reservations ADD COLUMN notes TEXT DEFAULT ''`,
  // 5: guest_name en reservations (importador CSV Airbnb)
  `ALTER TABLE reservations ADD COLUMN guest_name TEXT DEFAULT ''`,
  // 6: días de aviso del panel POR USUARIO (0 = usar el defecto global)
  `ALTER TABLE users ADD COLUMN lookahead_days INTEGER DEFAULT 0`,
  // 7: token por orden + checks/photos en maintenance_tasks; rol 'proveedor'
  `ALTER TABLE maintenance_tasks ADD COLUMN token_hash TEXT;
   ALTER TABLE maintenance_tasks ADD COLUMN checks TEXT DEFAULT '[]';
   ALTER TABLE maintenance_tasks ADD COLUMN photos TEXT DEFAULT '[]';
   UPDATE people SET role = 'proveedor' WHERE role = 'mantenimiento';
   UPDATE people SET token_hash = NULL WHERE role != 'limpieza'`,
  // 8: fecha REAL de reserva (CSV Airbnb 预订日期; '' = desconocida, p.ej. iCal)
  `ALTER TABLE reservations ADD COLUMN booked_date TEXT DEFAULT ''`,
  // 9: cerradura Tedee asociada a cada inmueble (id de lock cloud/bridge)
  `ALTER TABLE properties ADD COLUMN tedee_lock_id INTEGER`,
  // 10: nivel de notificaciones por usuario (all | important | none)
  `ALTER TABLE users ADD COLUMN notification_level TEXT DEFAULT 'all'`,
  // 11: display_name + avatar para Mi perfil
  `ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT '';
   ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''`,
  // 12: token en claro CIFRADO (ENC_KEY) para poder recuperar/volver a copiar
  //     el enlace de acceso. El hash sigue siendo el que valida en /api/t/:token.
  `ALTER TABLE people ADD COLUMN token_cipher TEXT;
   ALTER TABLE maintenance_tasks ADD COLUMN token_cipher TEXT`,
  // 13: notificaciones POR TIPO (notification_preferences) sustituyen al nivel
  //     all/important/none. La columna se elimina: las prefs son la única fuente.
  `ALTER TABLE users DROP COLUMN notification_level`,
  // 14: snapshot de instrucciones POR LIMPIEZA. Se hereda del inmueble al crear la
  //     limpieza y a partir de ahí es editable de forma independiente (nunca toca
  //     el maestro). El checklist ya vivía por limpieza en `checks`.
  `ALTER TABLE cleanings ADD COLUMN instructions TEXT DEFAULT ''`,
  // 15: número de huéspedes por reserva (feature airbnb-sync). En el CT se añadió
  //     a mano en su día; aquí se garantiza en instalaciones nuevas.
  `ALTER TABLE reservations ADD COLUMN guests INTEGER`,
]

export function migrate(db) {
  // Compat: BDs que ya tenían migraciones ad-hoc aplicadas (pre-versionado)
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER)')
  let current = db.prepare('SELECT MAX(version) v FROM schema_version').get().v ?? 0
  if (current === 0) {
    // Detectar qué migraciones ya estaban aplicadas por el sistema antiguo
    const has = (table, col) =>
      db.prepare('PRAGMA table_info(' + table + ')').all().some((c) => c.name === col)
    if (has('properties', 'bathrooms')) current = Math.max(current, 1)
    if (has('sessions', 'is_demo')) current = Math.max(current, 2)
    if (has('cleanings', 'work_log')) current = Math.max(current, 3)
    if (has('reservations', 'amount')) current = Math.max(current, 4)
    if (current > 0) {
      const tx = db.transaction(() => {
        for (let v = 1; v <= current; v++) {
          db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(v, Date.now())
        }
      })
      tx()
      console.log(`[db] schema_version inicializada en v${current} (migraciones ad-hoc previas)`)
    }
  }
  for (let i = current; i < MIGRATIONS.length; i++) {
    const tx = db.transaction(() => {
      try {
        db.exec(MIGRATIONS[i])
      } catch (err) {
        // ADD COLUMN puede fallar si la columna ya existe (p. ej. guests, añadida
        // a mano en el CT). Si la columna está presente, la migración se da por aplicada.
        const m = MIGRATIONS[i].match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/)
        if (!m) throw err
        const has = db.prepare('PRAGMA table_info(' + m[1] + ')').all().some((c) => c.name === m[2])
        if (!has) throw err
        console.log(`[db] migración ${i + 1} ya aplicada (columna ${m[2]} presente)`)
      }
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(i + 1, Date.now())
    })
    tx()
    console.log(`[db] migración ${i + 1} aplicada`)
  }
}

export function openDb(dataDir, filename = 'keynest.db') {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(join(dataDir, filename))
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      language TEXT DEFAULT 'auto',
      role TEXT DEFAULT 'user',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      ua TEXT
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      attempts INTEGER DEFAULT 0,
      locked_until INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0,
      window_end INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      bedrooms INTEGER DEFAULT 1,
      area INTEGER DEFAULT 0,
      photo TEXT DEFAULT '/prop-carmen.svg',
      ical_url TEXT DEFAULT '',
      checklist TEXT DEFAULT '[]',
      instructions TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      uid TEXT UNIQUE NOT NULL,
      checkin TEXT NOT NULL,
      checkout TEXT NOT NULL,
      summary TEXT DEFAULT '',
      confirmation_code TEXT DEFAULT '',
      phone_last4 TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reservations_property ON reservations(property_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_dates ON reservations(checkin, checkout);
    CREATE TABLE IF NOT EXISTS cleanings (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      reservation_id TEXT,
      date TEXT NOT NULL,
      status TEXT DEFAULT 'pendiente',
      assignee_ids TEXT DEFAULT '[]',
      estimated_hours REAL DEFAULT 2,
      checks TEXT DEFAULT '[]',
      photos TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cleanings_property ON cleanings(property_id);
    CREATE TABLE IF NOT EXISTS maintenance_tasks (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT DEFAULT '',
      expense_tag TEXT DEFAULT '',
      urgent INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'nueva',
      assignee_id TEXT,
      scheduled_date TEXT,
      cost REAL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_maint_property ON maintenance_tasks(property_id);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      detail TEXT,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      role TEXT DEFAULT 'limpieza',
      specialty TEXT DEFAULT '',
      hourly_rate REAL DEFAULT 10,
      token_hash TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      min_severity TEXT NOT NULL DEFAULT 'normal',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, tipo)
    );
    CREATE TABLE IF NOT EXISTS notification_quiet_hours (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      quiet_start INTEGER,
      quiet_end INTEGER,
      tz TEXT NOT NULL DEFAULT 'Europe/Madrid',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_queue (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'normal',
      datos_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
  `)

  migrate(db)

  return db
}

export function kvGet(db, key) {
  return db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value
}

export function kvSet(db, key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

/* ---- Secrets cifrados: AES-256-GCM, clave desde entorno (ENC_KEY) ---- */
/* Si ENC_KEY no existe, fallback a kv (legacy) con warning. Migración: generar ENC_KEY y reiniciar. */
let _encKeyWarned = false
function encKey(db) {
  const envKey = process.env.ENC_KEY
  if (envKey) {
    if (envKey.length < 32) {
      console.warn('[db] ENC_KEY demasiado corta (mín 32 chars), usando fallback kv')
    } else {
      return Buffer.from(envKey.padEnd(64, envKey).slice(0, 64), 'hex')
    }
  }
  if (!_encKeyWarned) {
    console.warn('[db] ENC_KEY no definida en entorno, usando clave en BD (menos seguro). Configura ENC_KEY en /etc/keynest/env')
    _encKeyWarned = true
  }
  let k = kvGet(db, 'enc_key')
  if (!k) {
    k = crypto.randomBytes(32).toString('hex')
    kvSet(db, 'enc_key', k)
  }
  return Buffer.from(k, 'hex')
}

export function encryptSecret(db, plaintext) {
  if (!plaintext) return ''
  const key = encKey(db)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

export function decryptSecret(db, stored) {
  if (!stored) return ''
  if (!stored.startsWith('gcm:')) return stored // legado en claro → se re-cifra al guardar
  const [, iv, tag, data] = stored.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(db), Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(tag, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8')
}

/* ---- Audit log (lección skill #25) ---- */
export function audit(db, userId, action, entity, entityId, detail = '') {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId || '', action, entity, entityId || '', String(detail).slice(0, 500), Date.now())
}

/* ---- Snapshot por limpieza (issue #39) ----
 * Las limpiezas antiguas (pre-migración 14, o con checks vacíos pre-asignación)
 * hidratan en caliente el checklist y las instrucciones del inmueble. En cuanto
 * se editan, fijan su propia copia y dejan de depender del maestro.
 * `properties` debe traer `checklist` ya parseado (array) e `instructions` (string). */
export function hydrateCleaning(cl, properties) {
  if (JSON.parse(cl.checks || '[]').length === 0) {
    const prop = properties.find((p) => p.id === cl.property_id)
    if (prop) cl.checks = JSON.stringify(prop.checklist.map((label, i) => ({ id: `chk-${i}`, label, done: false })))
  }
  if (!cl.instructions) {
    const prop = properties.find((p) => p.id === cl.property_id)
    if (prop) cl.instructions = prop.instructions ?? ''
  }
  return cl
}

/* ---- Borrado de limpiezas (issue #40) ----
 * Una limpieza es eliminable si NO se ha realizado: estado pendiente/asignada y
 * sin horas, productos ni fotos. Las en-curso/archivadas o con datos reales se
 * bloquean. `cl` es una fila de la BD (work_log/supplies/photos son JSON en string). */
export function canDeleteCleaning(cl) {
  return (cl.status === 'pendiente' || cl.status === 'asignada')
    && JSON.parse(cl.work_log || '[]').length === 0
    && JSON.parse(cl.supplies || '[]').length === 0
    && JSON.parse(cl.photos || '[]').length === 0
}
