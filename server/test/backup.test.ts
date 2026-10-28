import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { kvGet, kvSet, openDb, type DB } from '../src/db.js'
import { getBackupConfig, runBackup, verifyBackupFile } from '../src/backup.js'

let dir: string
let db: DB

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-backup-'))
  db = openDb(dir, 'test.db')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('verified backups', () => {
  it('does not collide when two backups start in the same second', async () => {
    const [first, second] = await Promise.all([
      runBackup(db, dir, 'test.db'),
      runBackup(db, dir, 'test.db'),
    ])

    expect('path' in first).toBe(true)
    expect('path' in second).toBe(true)
    const paths = [first, second].map((r) => (r as { path: string }).path)
    expect(paths[0]).not.toBe(paths[1])
    for (const path of paths) {
      expect(existsSync(path)).toBe(true)
      expect(verifyBackupFile(path).ok).toBe(true)
    }
    expect(readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.db'))).toHaveLength(2)
  })

  it('captures recent WAL data and only then records the backup time', async () => {
    kvSet(db, 'backup_probe', 'written-after-open')
    // El CT no tiene el binario sqlite3: reproducimos esa ruta restringiendo PATH.
    const emptyBin = join(dir, 'empty-bin')
    mkdirSync(emptyBin, { recursive: true })
    const originalPath = process.env.PATH
    process.env.PATH = emptyBin

    let result: Awaited<ReturnType<typeof runBackup>>
    try {
      result = await runBackup(db, dir, 'test.db')
    } finally {
      process.env.PATH = originalPath
    }

    expect('path' in result && result.path).toBeTruthy()
    const path = (result as { path: string }).path
    expect(existsSync(path)).toBe(true)
    const copy = new Database(path, { readonly: true, fileMustExist: true })
    expect(copy.pragma('quick_check', { simple: true })).toBe('ok')
    expect((copy.prepare('SELECT value FROM kv WHERE key = ?').get('backup_probe') as { value: string }).value)
      .toBe('written-after-open')
    for (const table of ['users', 'properties', 'reservations', 'cleanings', 'kv']) {
      const present = copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
      expect(present, table).toBeTruthy()
    }
    copy.close()
    expect(kvGet(db, 'backup_last')).toBeTruthy()
  })

  it('rejects a file that is not a usable database', () => {
    const bogus = join(dir, 'bogus.db')
    writeFileSync(bogus, 'not a database at all')

    const result = verifyBackupFile(bogus)

    expect(result.ok).toBe(false)
    expect('error' in result && result.error).toBeTruthy()
  })

  it('reports failure and keeps the previous timestamp when the copy cannot be written', async () => {
    kvSet(db, 'backup_last', '2026-01-01T00:00:00.000Z')
    mkdirSync(join(dir, 'backups'), { recursive: true })
    rmSync(join(dir, 'backups'), { recursive: true, force: true })
    writeFileSync(join(dir, 'backups'), 'blocks the directory')

    const result = await runBackup(db, dir, 'test.db')

    expect('error' in result && result.error).toBeTruthy()
    expect(getBackupConfig(db).lastBackup).toBe('2026-01-01T00:00:00.000Z')
    expect(readdirSync(dir).filter((name) => name.endsWith('.db') && name !== 'test.db')).toEqual([])
  })
})
