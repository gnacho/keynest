import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from 'hono'
import { openDb, kvSet, type DB } from '../src/db.js'
import { ensureBootstrapAdmin, handleLogin } from '../src/auth.js'

let dir: string
let db: DB
const oldSecret = process.env.SESSION_SECRET
const oldTrust = process.env.TRUST_PROXY

interface LoginContext {
  c: Context
  cookies: string[]
}

function loginContext(url: string, headers: Record<string, string> = {}): LoginContext {
  const cookies: string[] = []
  const c = {
    req: {
      url,
      raw: { headers: new Headers({ 'user-agent': 'test-ua', ...headers }) },
      header: (name: string) => new Headers({ 'user-agent': 'test-ua', ...headers }).get(name) ?? undefined,
    },
    header: (name: string, value: string) => { if (name.toLowerCase() === 'set-cookie') cookies.push(value) },
  } as unknown as Context
  return { c, cookies }
}

beforeEach(async () => {
  process.env.SESSION_SECRET = 's'.repeat(64)
  delete process.env.TRUST_PROXY
  dir = mkdtempSync(join(tmpdir(), 'keynest-secure-'))
  db = openDb(dir, 'test.db')
  await ensureBootstrapAdmin(db, { authUser: 'admin', authPass: 'secreto123' })
  kvSet(db, 'probe', '1')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  if (oldSecret === undefined) delete process.env.SESSION_SECRET
  else process.env.SESSION_SECRET = oldSecret
  if (oldTrust === undefined) delete process.env.TRUST_PROXY
  else process.env.TRUST_PROXY = oldTrust
})

describe('cookie transport', () => {
  it('sets Secure on an HTTPS request', async () => {
    const { c, cookies } = loginContext('https://keynest.example/api/auth/login')
    expect(await handleLogin(db, c, { username: 'admin', password: 'secreto123' })).not.toBeNull()
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatch(/;\s*Secure/i)
    expect(cookies[0]).toMatch(/HttpOnly/i)
  })

  it('omits Secure on plain HTTP so local LAN logins keep working', async () => {
    const { c, cookies } = loginContext('http://192.168.1.100:8081/api/auth/login')
    expect(await handleLogin(db, c, { username: 'admin', password: 'secreto123' })).not.toBeNull()
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).not.toMatch(/;\s*Secure/i)
  })

  it('honours the forwarded proto only behind a trusted proxy', async () => {
    const trusted = loginContext('http://10.0.0.5/api/auth/login', { 'x-forwarded-proto': 'https' })
    process.env.TRUST_PROXY = 'true'
    await handleLogin(db, trusted.c, { username: 'admin', password: 'secreto123' })
    expect(trusted.cookies[0]).toMatch(/;\s*Secure/i)

    delete process.env.TRUST_PROXY
    const untrusted = loginContext('http://10.0.0.5/api/auth/login', { 'x-forwarded-proto': 'https' })
    await handleLogin(db, untrusted.c, { username: 'admin', password: 'secreto123' })
    expect(untrusted.cookies[0]).not.toMatch(/;\s*Secure/i)
  })

  it('reads the last forwarded hop, the one the trusted proxy adds', async () => {
    process.env.TRUST_PROXY = 'true'

    const spoofed = loginContext('http://10.0.0.5/api/auth/login', { 'x-forwarded-proto': 'http, https' })
    await handleLogin(db, spoofed.c, { username: 'admin', password: 'secreto123' })
    expect(spoofed.cookies[0]).toMatch(/;\s*Secure/i)

    const downgraded = loginContext('http://10.0.0.5/api/auth/login', { 'x-forwarded-proto': 'https, http' })
    await handleLogin(db, downgraded.c, { username: 'admin', password: 'secreto123' })
    expect(downgraded.cookies[0]).not.toMatch(/;\s*Secure/i)
  })
})
