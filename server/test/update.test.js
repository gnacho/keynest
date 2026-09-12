import { test, expect, describe, it, vi } from 'vitest'
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

test('updateStatus marca checkFailed cuando GitHub no responde (#231)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keynest-checkfailed-'))
  const db = openDb(dir, 'test.db')
  const realFetch = global.fetch
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 403 })))
  try {
    const st = await updateStatus(db, dir)
    expect(st.latest).toBeNull()
    expect(st.checkFailed).toBe(true)
    expect(st.available).toBe(false)
  } finally {
    vi.unstubAllGlobals()
    global.fetch = realFetch
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

const seedCache = (db, entry) =>
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('gh_latest_release', JSON.stringify(entry))

describe('latestInfo anti rate-limit (#265)', () => {
  const withDb = async (fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'keynest-lkg-'))
    const db = openDb(dir, 'test.db')
    try {
      await fn(db, dir)
    } finally {
      vi.unstubAllGlobals()
      delete process.env.GITHUB_TOKEN
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const resOk = (data, etag) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    headers: { get: (h) => (h === 'etag' ? etag : null) },
  })
  const res403 = () => ({
    ok: false,
    status: 403,
    headers: { get: () => null },
  })

  it('un 403 tras el TTL sirve el last-known-good ≤24h como stale', async () => {
    await withDb(async (db, dir) => {
      seedCache(db, { at: Date.now() - 10 * 60 * 1000, id: '9.9.9', body: '- nota', etag: 'W/"a1"' })
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res403())))
      const st = await updateStatus(db, dir)
      expect(st.latest).toBe('9.9.9')
      expect(st.notes).toBe('- nota')
      expect(st.checkFailed).toBe(false)
      expect(st.stale).toBe(true)
    })
  })

  it('un 403 sin caché útil (<24h superada) sigue siendo checkFailed', async () => {
    await withDb(async (db, dir) => {
      seedCache(db, { at: Date.now() - 25 * 60 * 60 * 1000, id: '9.9.9', body: '' })
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res403())))
      const st = await updateStatus(db, dir)
      expect(st.latest).toBeNull()
      expect(st.checkFailed).toBe(true)
    })
  })

  it('un 304 confirma la caché y refresca su ventana', async () => {
    await withDb(async (db, dir) => {
      const at0 = Date.now() - 10 * 60 * 1000
      seedCache(db, { at: at0, id: '9.9.9', body: '- nota', etag: 'W/"a1"' })
      const calls = []
      vi.stubGlobal('fetch', vi.fn((_, init) => {
        calls.push(init.headers)
        return Promise.resolve({ ok: false, status: 304, headers: { get: () => null } })
      }))
      const st = await updateStatus(db, dir)
      expect(st.latest).toBe('9.9.9')
      expect(st.stale).toBe(false)
      // petición condicional con el etag de la caché
      expect(calls[0]['If-None-Match']).toBe('W/"a1"')
      // la ventana de la caché se refrescó (at > at0)
      const saved = JSON.parse(db.prepare('SELECT value FROM kv WHERE key = ?').get('gh_latest_release').value)
      expect(saved.at).toBeGreaterThan(at0)
      expect(saved.etag).toBe('W/"a1"')
    })
  })

  it('un 200 guarda el etag del release y GITHUB_TOKEN viaja como Bearer', async () => {
    await withDb(async (db, dir) => {
      process.env.GITHUB_TOKEN = 'ghp_testtoken'
      const calls = []
      vi.stubGlobal('fetch', vi.fn((_, init) => {
        calls.push(init.headers)
        return Promise.resolve(resOk({ tag_name: 'v9.9.10', body: 'x' }, 'W/"b2"'))
      }))
      const st = await updateStatus(db, dir)
      expect(st.latest).toBe('9.9.10')
      expect(st.stale).toBe(false)
      expect(calls[0].Authorization).toBe('Bearer ghp_testtoken')
      const saved = JSON.parse(db.prepare('SELECT value FROM kv WHERE key = ?').get('gh_latest_release').value)
      expect(saved.etag).toBe('W/"b2"')
    })
  })
})
