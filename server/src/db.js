import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

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
  `)

  // Migraciones: columnas añadidas después del esquema inicial
  const propCols = db.prepare('PRAGMA table_info(properties)').all().map((c) => c.name)
  if (!propCols.includes('bathrooms')) {
    db.exec('ALTER TABLE properties ADD COLUMN bathrooms INTEGER DEFAULT 1')
    console.log('[db] migración: columna bathrooms añadida a properties')
  }
  const sessCols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name)
  if (!sessCols.includes('is_demo')) {
    db.exec('ALTER TABLE sessions ADD COLUMN is_demo INTEGER DEFAULT 0')
    console.log('[db] migración: columna is_demo añadida a sessions')
  }
  const resCols = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name)
  if (!resCols.includes('amount')) {
    db.exec('ALTER TABLE reservations ADD COLUMN amount REAL DEFAULT 0')
    db.exec("ALTER TABLE reservations ADD COLUMN notes TEXT DEFAULT ''")
    console.log('[db] migración: columnas amount/notes añadidas a reservations')
  }
  const cleanCols = db.prepare('PRAGMA table_info(cleanings)').all().map((c) => c.name)
  if (!cleanCols.includes('work_log')) {
    db.exec('ALTER TABLE cleanings ADD COLUMN work_log TEXT')
    db.exec('ALTER TABLE cleanings ADD COLUMN supplies TEXT')
    db.exec('ALTER TABLE cleanings ADD COLUMN materials REAL')
    console.log('[db] migración: columnas work_log/supplies/materials añadidas a cleanings')
  }

  return db
}

export function kvGet(db, key) {
  return db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value
}

export function kvSet(db, key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
