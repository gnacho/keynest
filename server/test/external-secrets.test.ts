import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, kvGet, kvSet, openDb, type DB } from '../src/db.js'
import { ensureExternalSecrets } from '../src/external-secrets.js'

const OLD_ENC = 'a'.repeat(64)
const OLD_SESSION = 'c'.repeat(64)

describe('automatic external secret storage', () => {
  let dir: string
  let db: DB
  let oldEnv: string | undefined
  let oldSession: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'keynest-external-secrets-'))
    db = openDb(dir, 'test.db')
    oldEnv = process.env.ENC_KEY
    oldSession = process.env.SESSION_SECRET
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
    if (oldEnv === undefined) delete process.env.ENC_KEY
    else process.env.ENC_KEY = oldEnv
    if (oldSession === undefined) delete process.env.SESSION_SECRET
    else process.env.SESSION_SECRET = oldSession
  })

  function seedCipher() {
    process.env.ENC_KEY = OLD_ENC
    const cipher = encryptSecret(db, 'fictitious-person-token')
    db.prepare('INSERT INTO people (id, name, token_cipher, created_at) VALUES (?, ?, ?, ?)')
      .run('person-1', 'Fictitious person', cipher, Date.now())
  }

  function expectMigrated() {
    const file = join(dir, 'secrets.env')
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(process.env.ENC_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(process.env.SESSION_SECRET).toMatch(/^[a-f0-9]{64}$/)
    expect(process.env.ENC_KEY).not.toBe(OLD_ENC)
    expect(process.env.SESSION_SECRET).not.toBe(OLD_SESSION)
    const row = db.prepare('SELECT token_cipher FROM people WHERE id = ?').get('person-1') as { token_cipher: string }
    expect(decryptSecret(db, row.token_cipher)).toBe('fictitious-person-token')
    expect(kvGet(db, 'enc_key')).toBeUndefined()
    expect(kvGet(db, 'session_secret')).toBeUndefined()
  }

  it('externalizes a legacy database and reloads the same file on restart', () => {
    seedCipher()
    kvSet(db, 'enc_key', OLD_ENC)
    kvSet(db, 'session_secret', OLD_SESSION)
    delete process.env.ENC_KEY
    delete process.env.SESSION_SECRET

    ensureExternalSecrets(dir, [db])
    expectMigrated()
    const externalKey = process.env.ENC_KEY
    delete process.env.ENC_KEY
    delete process.env.SESSION_SECRET

    ensureExternalSecrets(dir, [db])
    expect(process.env.ENC_KEY).toBe(externalKey)
  })

  it('migrates when ENC_KEY is external and only the session key is legacy', () => {
    seedCipher()
    kvSet(db, 'session_secret', OLD_SESSION)
    delete process.env.SESSION_SECRET

    ensureExternalSecrets(dir, [db])
    expectMigrated()
    const migratedEnc = process.env.ENC_KEY
    const migratedSession = process.env.SESSION_SECRET
    process.env.ENC_KEY = OLD_ENC
    delete process.env.SESSION_SECRET

    ensureExternalSecrets(dir, [db])
    expect(process.env.ENC_KEY).toBe(migratedEnc)
    expect(process.env.SESSION_SECRET).toBe(migratedSession)
  })

  it('migrates when SESSION_SECRET is external and only the encryption key is legacy', () => {
    seedCipher()
    kvSet(db, 'enc_key', OLD_ENC)
    process.env.SESSION_SECRET = OLD_SESSION
    delete process.env.ENC_KEY

    ensureExternalSecrets(dir, [db])
    expectMigrated()
    const migratedEnc = process.env.ENC_KEY
    const migratedSession = process.env.SESSION_SECRET
    delete process.env.ENC_KEY
    process.env.SESSION_SECRET = OLD_SESSION

    ensureExternalSecrets(dir, [db])
    expect(process.env.ENC_KEY).toBe(migratedEnc)
    expect(process.env.SESSION_SECRET).toBe(migratedSession)
  })

  it('completes a partial external configuration without legacy database keys', () => {
    delete process.env.ENC_KEY
    process.env.SESSION_SECRET = OLD_SESSION
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run('session-1', 'user-1', Date.now(), Date.now() + 60000)

    ensureExternalSecrets(dir, [db])

    expect(existsSync(join(dir, 'secrets.env'))).toBe(true)
    expect(process.env.ENC_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(process.env.SESSION_SECRET).toMatch(/^[a-f0-9]{64}$/)
    expect((db.prepare('SELECT COUNT(*) count FROM sessions').get() as { count: number }).count).toBe(0)
  })

  it('refuses ciphertext when no old encryption key is available', () => {
    seedCipher()
    delete process.env.ENC_KEY
    process.env.SESSION_SECRET = OLD_SESSION

    expect(() => ensureExternalSecrets(dir, [db])).toThrow(/incomplete/)
    expect(existsSync(join(dir, 'secrets.env'))).toBe(false)
  })

  it('fails closed for a fresh database without external secrets', () => {
    delete process.env.ENC_KEY
    delete process.env.SESSION_SECRET

    expect(() => ensureExternalSecrets(dir, [db])).toThrow(/ENC_KEY/)
    expect(existsSync(join(dir, 'secrets.env'))).toBe(false)
  })

  it('keeps explicit external configuration without creating a file', () => {
    process.env.ENC_KEY = 'b'.repeat(64)
    process.env.SESSION_SECRET = 'd'.repeat(64)

    ensureExternalSecrets(dir, [db])
    expect(existsSync(join(dir, 'secrets.env'))).toBe(false)
  })
})
