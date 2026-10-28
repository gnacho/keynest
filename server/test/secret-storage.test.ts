import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from 'hono'
import { decryptSecret, encryptSecret, kvGet, kvSet, openDb, type DB } from '../src/db.js'
import { sessionFromCookie } from '../src/auth.js'
import { migrateLegacySecrets } from '../src/secrets-migration.js'

describe('external secret storage', () => {
  let dir: string
  let db: DB
  const oldEncKey = process.env.ENC_KEY
  const oldSessionSecret = process.env.SESSION_SECRET

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'keynest-secrets-'))
    db = openDb(dir, 'test.db')
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
    if (oldEncKey === undefined) delete process.env.ENC_KEY
    else process.env.ENC_KEY = oldEncKey
    if (oldSessionSecret === undefined) delete process.env.SESSION_SECRET
    else process.env.SESSION_SECRET = oldSessionSecret
  })

  it('fails closed when ENC_KEY is missing', () => {
    delete process.env.ENC_KEY

    expect(() => encryptSecret(db, 'fictitious-secret')).toThrow(/ENC_KEY/)
  })

  it('fails closed when SESSION_SECRET is missing', () => {
    delete process.env.SESSION_SECRET
    const c = {
      req: { raw: { headers: new Headers({ cookie: `keynest_session=abc.${'0'.repeat(64)}` }) } },
    } as unknown as Context

    expect(() => sessionFromCookie(db, c)).toThrow(/SESSION_SECRET/)
  })

  it('keeps an unmigrated legacy database readable without creating new database keys', () => {
    kvSet(db, 'enc_key', 'a'.repeat(64))
    kvSet(db, 'session_secret', 'c'.repeat(64))
    delete process.env.ENC_KEY
    delete process.env.SESSION_SECRET

    const cipher = encryptSecret(db, 'legacy-fictitious-secret')

    expect(decryptSecret(db, cipher)).toBe('legacy-fictitious-secret')
    expect((db.prepare('SELECT COUNT(*) count FROM kv WHERE key IN (?, ?)').get('enc_key', 'session_secret') as { count: number }).count).toBe(2)
  })

  it('preserves ciphertext that already matches the external key when kv is stale', () => {
    process.env.ENC_KEY = 'b'.repeat(64)
    process.env.SESSION_SECRET = 'd'.repeat(64)
    const cipher = encryptSecret(db, 'current-token-fictitious')
    db.prepare('INSERT INTO people (id, name, token_cipher, created_at) VALUES (?, ?, ?, ?)')
      .run('person-current', 'Fictitious person', cipher, Date.now())
    kvSet(db, 'enc_key', 'a'.repeat(64))
    kvSet(db, 'session_secret', 'c'.repeat(64))

    expect(migrateLegacySecrets(db)).toBe(true)

    const row = db.prepare('SELECT token_cipher FROM people WHERE id = ?').get('person-current') as { token_cipher: string }
    expect(row.token_cipher).toBe(cipher)
    expect(decryptSecret(db, row.token_cipher)).toBe('current-token-fictitious')
    expect(kvGet(db, 'enc_key')).toBeUndefined()
  })

  it('reencrypts legacy tokens and revokes existing credentials', () => {
    const oldKey = 'a'.repeat(64)
    const newKey = 'b'.repeat(64)
    process.env.ENC_KEY = oldKey
    const personCipher = encryptSecret(db, 'person-token-fictitious')
    const taskCipher = encryptSecret(db, 'task-token-fictitious')
    const tedeeCipher = encryptSecret(db, 'tedee-token-fictitious')
    db.prepare('INSERT INTO people (id, name, token_cipher, created_at) VALUES (?, ?, ?, ?)')
      .run('person-1', 'Fictitious person', personCipher, Date.now())
    db.prepare('INSERT INTO maintenance_tasks (id, property_id, title, token_cipher, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('task-1', 'property-1', 'Fictitious task', taskCipher, Date.now())
    kvSet(db, 'tedee_token', tedeeCipher)
    kvSet(db, 'enc_key', oldKey)
    kvSet(db, 'session_secret', 'c'.repeat(64))
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run('user-1', 'fictitious-user', 'not-a-real-hash', Date.now())
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run('session-1', 'user-1', Date.now(), Date.now() + 60000)
    db.prepare('INSERT INTO login_tokens (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run('restore-1', 'user-1', 'fictitious-hash', Date.now(), Date.now() + 60000)
    process.env.ENC_KEY = newKey
    process.env.SESSION_SECRET = 'd'.repeat(64)

    expect(migrateLegacySecrets(db)).toBe(true)

    const person = db.prepare('SELECT token_cipher FROM people WHERE id = ?').get('person-1') as { token_cipher: string }
    const task = db.prepare('SELECT token_cipher FROM maintenance_tasks WHERE id = ?').get('task-1') as { token_cipher: string }
    const storedTedee = kvGet(db, 'tedee_token')
    expect(storedTedee).toBeDefined()
    expect(decryptSecret(db, person.token_cipher)).toBe('person-token-fictitious')
    expect(decryptSecret(db, task.token_cipher)).toBe('task-token-fictitious')
    expect(decryptSecret(db, storedTedee!)).toBe('tedee-token-fictitious')
    expect(kvGet(db, 'enc_key')).toBeUndefined()
    expect(kvGet(db, 'session_secret')).toBeUndefined()
    expect((db.prepare('SELECT COUNT(*) count FROM sessions').get() as { count: number }).count).toBe(0)
    expect((db.prepare('SELECT COUNT(*) count FROM login_tokens').get() as { count: number }).count).toBe(0)
  })
})
