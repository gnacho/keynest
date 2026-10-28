import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { kvGet, kvSet } from './db.js'
import type { DB } from './db.js'

const BACKUP_DIR_NAME = 'backups'
// Tablas sin las cuales la copia no sirve para recuperar la instalación.
const ESSENTIAL_TABLES = ['users', 'properties', 'reservations', 'cleanings', 'kv']

export function backupDirPath(dataDir: string): string {
  return join(dataDir, BACKUP_DIR_NAME)
}

export type BackupResult =
  | { ok: true; path: string; bytes: number; quickCheck: 'ok' }
  | { error: string; detail?: string }

export function getBackupConfig(db: DB) {
  return {
    enabled: kvGet(db, 'backup_enabled') === '1',
    retentionDays: Number(kvGet(db, 'backup_retention_days') || 7),
    lastBackup: kvGet(db, 'backup_last'),
  }
}

export function setBackupConfig(db: DB, { enabled, retentionDays }: { enabled?: boolean; retentionDays?: number }) {
  if (enabled !== undefined) kvSet(db, 'backup_enabled', enabled ? '1' : '0')
  if (retentionDays !== undefined) kvSet(db, 'backup_retention_days', String(Math.max(1, Math.min(90, retentionDays))))
  return getBackupConfig(db)
}

/* Abre la copia como BD independiente y comprueba que sirve para recuperar:
   tamaño > 0, quick_check correcto y tablas esenciales presentes. */
export function verifyBackupFile(path: string): { ok: true; bytes: number } | { ok: false; error: string } {
  try {
    const bytes = statSync(path).size
    if (!Number.isFinite(bytes) || bytes <= 0) return { ok: false, error: 'copia vacía' }
    const copy = new Database(path, { readonly: true, fileMustExist: true })
    try {
      const check = copy.pragma('quick_check', { simple: true })
      if (check !== 'ok') return { ok: false, error: `quick_check: ${String(check)}` }
      const missing = ESSENTIAL_TABLES.filter(
        (table) => !copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
      )
      if (missing.length > 0) return { ok: false, error: `faltan tablas: ${missing.join(', ')}` }
    } finally {
      copy.close()
    }
    return { ok: true, bytes }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

function discard(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch { /* la copia nunca llegó a crearse */ }
}

/* Copia con la API de backup de SQLite: incluye el WAL y no depende de que el
   servidor tenga el binario sqlite3 instalado. Solo actualiza backup_last
   cuando la copia se ha verificado. */
export async function runBackup(db: DB, dataDir: string, dbName = 'keynest.db'): Promise<BackupResult> {
  const backupDir = backupDirPath(dataDir)
  // Milisegundos y sufijo aleatorio: dos copias en el mismo segundo (doble
  // clic, cron y petición manual) no deben apuntar al mismo fichero.
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
  const suffix = randomBytes(3).toString('hex')
  const backupPath = join(backupDir, `${dbName.replace('.db', '')}-${timestamp}-${suffix}.db`)

  try {
    mkdirSync(backupDir, { recursive: true })
    // Las copias contienen la misma informacion sensible que la BD viva.
    try { chmodSync(backupDir, 0o700) } catch { /* sin permisos POSIX */ }
    await db.backup(backupPath)
    try { chmodSync(backupPath, 0o600) } catch { /* idem */ }
  } catch (err) {
    discard(backupPath)
    return { error: 'backup-fallido', detail: (err as Error).message }
  }

  const verified = verifyBackupFile(backupPath)
  if (!verified.ok) {
    discard(backupPath)
    return { error: 'backup-invalido', detail: verified.error }
  }

  kvSet(db, 'backup_last', new Date().toISOString())
  return { ok: true, path: backupPath, bytes: verified.bytes, quickCheck: 'ok' }
}

export function cleanOldBackups(dataDir: string, dbName = 'keynest.db', retentionDays = 7) {
  const backupDir = backupDirPath(dataDir)
  if (!existsSync(backupDir)) return { cleaned: 0 }

  const prefix = dbName.replace('.db', '') + '-'
  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000
  let cleaned = 0

  for (const file of readdirSync(backupDir)) {
    if (!file.startsWith(prefix) || !file.endsWith('.db')) continue
    const filePath = join(backupDir, file)
    const stat = statSync(filePath)
    if (stat.mtimeMs < cutoff) {
      unlinkSync(filePath)
      cleaned++
    }
  }
  return { cleaned }
}
