import { test, expect, describe, it } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.js'
import { updateProgress, updateStatus } from '../src/update.js'

test('currentId reads the release marker from RELEASE_MARKER env override', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keynest-marker-'))
  const marker = join(dir, '.release-id')
  writeFileSync(marker, '9.9.9')
  process.env.RELEASE_MARKER = marker
  try {
    const mod = await import('../src/update.js?marker-override')
    expect(mod.currentId()).toBe('9.9.9')
  } finally {
    delete process.env.RELEASE_MARKER
  }
})

test('currentId returns empty when the marker path does not exist', async () => {
  process.env.RELEASE_MARKER = '/nonexistent/does-not-exist/.release-id'
  try {
    const mod = await import('../src/update.js?marker-missing')
    expect(mod.currentId()).toBe('')
  } finally {
    delete process.env.RELEASE_MARKER
  }
})

test('requestRollback writes the rollback flag and requestUpdate writes the update flag', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keynest-flags-'))
  const marker = join(dir, '.release-id')
  writeFileSync(marker, '1.5.40')
  process.env.RELEASE_MARKER = marker
  try {
    const mod = await import('../src/update.js?flags-override')
    const db = { prepare: () => ({ run: () => ({}) }) } // mock mínima de DB
    expect(mod.requestUpdate(db, 'u1', dir)).toBe(true)
    expect(existsSync(join(dir, '.update-requested'))).toBe(true)
    expect(mod.requestRollback(db, 'u1', dir)).toBe(true)
    expect(existsSync(join(dir, '.rollback-requested'))).toBe(true)
  } finally {
    delete process.env.RELEASE_MARKER
  }
})

test('readinessChecks reports disk/writable/concurrent/asset without throwing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keynest-readiness-'))
  const marker = join(dir, '.release-id')
  writeFileSync(marker, '1.5.40')
  process.env.RELEASE_MARKER = marker
  try {
    const mod = await import('../src/update.js?readiness-override')
    const db = { prepare: () => ({ run: () => ({}) }) }
    const r = await mod.readinessChecks(db, dir, null)
    // Sin release latest → asset queda con ok default true (no comprobable).
    expect(typeof r.disk).toBe('object')
    expect(typeof r.writable.ok).toBe('boolean')
    expect(typeof r.concurrent.ok).toBe('boolean')
    expect(typeof r.asset.ok).toBe('boolean')
    expect(r.writable.ok).toBe(true) // dir temporal creado por mkdtempSync es escribible
  } finally {
    delete process.env.RELEASE_MARKER
  }
})

test('readinessChecks flags a pending update flag as concurrent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keynest-concurrent-'))
  const marker = join(dir, '.release-id')
  writeFileSync(marker, '1.5.40')
  writeFileSync(join(dir, '.update-requested'), 'now')
  process.env.RELEASE_MARKER = marker
  try {
    const mod = await import('../src/update.js?concurrent-override')
    const db = { prepare: () => ({ run: () => ({}) }) }
    const r = await mod.readinessChecks(db, dir, null)
    expect(r.concurrent.ok).toBe(false)
  } finally {
    delete process.env.RELEASE_MARKER
  }
})

describe('updateProgress (#232)', () => {
  it('devuelve step/pct si el fichero es fresco', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keynest-progress-'))
    writeFileSync(
      join(dir, 'update-progress.json'),
      JSON.stringify({ step: 'download', pct: 25, ts: Date.now() })
    )
    expect(updateProgress(dir)).toMatchObject({ step: 'download', pct: 25 })
    rmSync(dir, { recursive: true, force: true })
  })

  it('un fichero stale (corrida muerta) no se reporta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keynest-progress-stale-'))
    writeFileSync(
      join(dir, 'update-progress.json'),
      JSON.stringify({ step: 'download', pct: 25, ts: Date.now() - 20 * 60 * 1000 })
    )
    expect(updateProgress(dir)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin fichero devuelve null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keynest-progress-empty-'))
    expect(updateProgress(dir)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('updateStatus notes (#232)', () => {
  it('devuelve las notas del release desde la caché kv', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'keynest-notes-'))
    const db = openDb(dir, 'test.db')
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('gh_latest_release', JSON.stringify({ at: Date.now(), id: '9.9.9', body: '- Nota de prueba' }))
    const st = await updateStatus(db, dir)
    expect(st.latest).toBe('9.9.9')
    expect(st.notes).toBe('- Nota de prueba')
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
