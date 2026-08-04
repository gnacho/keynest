import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { kvGet, kvSet } from './db.js'

const BACKUP_DIR_NAME = 'backups'

export function getBackupConfig(db) {
  return {
    enabled: kvGet(db, 'backup_enabled') === '1',
    retentionDays: Number(kvGet(db, 'backup_retention_days') || 7),
    lastBackup: kvGet(db, 'backup_last'),
  }
}

export function setBackupConfig(db, { enabled, retentionDays }) {
  if (enabled !== undefined) kvSet(db, 'backup_enabled', enabled ? '1' : '0')
  if (retentionDays !== undefined) kvSet(db, 'backup_retention_days', String(Math.max(1, Math.min(90, retentionDays))))
  return getBackupConfig(db)
}

export function runBackup(db, dataDir, dbName = 'keynest.db') {
  const dbPath = join(dataDir, dbName)
  if (!existsSync(dbPath)) return { error: 'bd-no-encontrada' }

  const backupDir = join(dataDir, BACKUP_DIR_NAME)
  mkdirSync(backupDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupPath = join(backupDir, `${dbName.replace('.db', '')}-${timestamp}.db`)

  try {
    execSync(`sqlite3 "${dbPath}" ".backup '${backupPath}'"`, { stdio: 'ignore' })
  } catch {
    copyFileSync(dbPath, backupPath)
  }

  kvSet(db, 'backup_last', new Date().toISOString())
  return { ok: true, path: backupPath }
}

export function cleanOldBackups(dataDir, dbName = 'keynest.db', retentionDays = 7) {
  const backupDir = join(dataDir, BACKUP_DIR_NAME)
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
