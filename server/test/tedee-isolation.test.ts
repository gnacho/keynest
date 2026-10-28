import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { createHmac, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { kvSet, openDb } from '../src/db.js'
import type { DB } from '../src/db.js'
import { requireAuth } from '../src/auth.js'

/* /api/tedee/test debe consultar la BD de la sesión. Antes usaba siempre
   prodDb, así que una sesión de demo leía la configuración real. */
const consulted: string[] = []

vi.mock('../src/tedee.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/tedee.js')>()
  return {
    ...actual,
    tedeeLocks: vi.fn(async (db: DB) => {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'tedee_url'").get() as { value: string } | undefined
      consulted.push(row?.value ?? 'sin-configurar')
      return []
    }),
  }
})

const sessionSecret = 'c'.repeat(64)

let dir: string
let prod: DB
let demo: DB

beforeEach(() => {
  process.env.ENC_KEY = 'a'.repeat(64)
  process.env.SESSION_SECRET = sessionSecret
  dir = mkdtempSync(join(tmpdir(), 'keynest-tedee-route-'))
  prod = openDb(dir, 'keynest.db')
  demo = openDb(dir, 'keynest_demo.db')
  kvSet(prod, 'tedee_url', 'https://prod.ficticio.test')
  kvSet(demo, 'tedee_url', 'https://demo.ficticio.test')
  consulted.length = 0
})

afterEach(() => {
  prod.close()
  demo.close()
  rmSync(dir, { recursive: true, force: true })
})

function cookieFor(sessionId: string): string {
  const mac = createHmac('sha256', sessionSecret).update(sessionId).digest('hex')
  return `keynest_session=${sessionId}.${mac}`
}

/** Inserta una sesión igual que createSession (no exportada). */
function seedSession(userId: string, isDemo: boolean): string {
  const id = randomUUID()
  prod.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo, remember) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, Date.now(), Date.now() + 3_600_000, 'test-ua', isDemo ? 1 : 0, 0)
  return id
}

/** Copia exacta del handler de producción: aquí es donde estaba el defecto. */
function registerTedeeTest(app: Hono<{ Variables: { db: DB } }>, pick: (c: any) => DB) {
  app.get('/api/tedee/test', requireAuth(prod, demo), async (c) => {
    try {
      const locks = await (await import('../src/tedee.js')).tedeeLocks(pick(c))
      return c.json({ ok: true, locks })
    } catch (err) {
      return c.json({ ok: false, code: (err as Error).message })
    }
  })
}

async function call(app: Hono<{ Variables: { db: DB } }>, cookie: string) {
  const res = await app.request('/api/tedee/test', { headers: { cookie } })
  return { status: res.status, body: await res.json() }
}

describe('tedee test endpoint isolation', () => {
  it('the shipped route reads the database bound to the session', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const start = source.indexOf("app.get('/api/tedee/test'")
    expect(start).toBeGreaterThan(-1)
    const route = source.slice(start, source.indexOf('\n})', start) + 3)

    expect(route).not.toMatch(/tedeeLocks\(prodDb\)/)
    expect(route).toMatch(/tedeeLocks\(c\.get\('db'\)\)/)
    expect(route).toMatch(/is_demo/)
  })

  it('reads the demo database for a demo session', async () => {
    demo.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('demo-user', 'demo', 'not-a-real-hash', 'demo', Date.now())
    const app = new Hono<{ Variables: { db: DB } }>()
    registerTedeeTest(app, (c) => c.get('db'))

    await call(app, cookieFor(seedSession('demo-user', true)))

    expect(consulted).toEqual(['https://demo.ficticio.test'])
  })

  it('keeps using the production database for a production session', async () => {
    prod.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('prod-user-318', 'prod-user-318', 'not-a-real-hash', 'admin', Date.now())
    const app = new Hono<{ Variables: { db: DB } }>()
    registerTedeeTest(app, (c) => c.get('db'))

    await call(app, cookieFor(seedSession('prod-user-318', false)))

    expect(consulted).toEqual(['https://prod.ficticio.test'])
  })
})
