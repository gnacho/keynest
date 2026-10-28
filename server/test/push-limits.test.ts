import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import webpush from 'web-push'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB, type UserRow } from '../src/db.js'
import { configurePush, notifyUsers, _setSendFn, _resetForTests } from '../src/push.js'
import { registerPushRoutes } from '../src/routes-push.js'
import {
  MAX_CONCURRENT_PUSH,
  MAX_SUBSCRIPTIONS_PER_USER,
  mapWithConcurrency,
  subscribeRateLimited,
  subscriptionCount,
  subscriptionQuotaAllows,
} from '../src/push-limits.js'

let dir: string
let db: DB
const userId = 'user-limits'

function insertSub(endpoint: string, index: number) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, 'k', 'a', 'test', ?, ?)`
  ).run(`sub-${index}-${Math.random().toString(36).slice(2)}`, userId, endpoint, now, now)
}

function subscribePayload(endpoint: string) {
  return { endpoint, keys: { p256dh: 'public-key-material', auth: 'auth-secret-material' } }
}

function buildApp() {
  const app = new Hono<{ Variables: { db: DB; user: UserRow } }>()
  app.use('*', async (c, next) => {
    c.set('user', { id: userId, username: 'limits', email: null, phone: null, language: 'auto', role: 'user' } as UserRow)
    c.set('db', db)
    await next()
  })
  registerPushRoutes(app as never)
  return app
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-push-limits-'))
  db = openDb(dir, 'test.db')
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, 'limits', 'x', Date.now())
  const keys = webpush.generateVAPIDKeys()
  configurePush({ publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:test@example.com' })
})

afterEach(() => {
  _resetForTests()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('subscription quota', () => {
  it('counts per user and allows only existing endpoints at the limit', () => {
    expect(subscriptionCount(db, userId)).toBe(0)
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_USER; i++) insertSub(`https://push.example/${i}`, i)

    expect(subscriptionCount(db, userId)).toBe(MAX_SUBSCRIPTIONS_PER_USER)
    expect(subscriptionQuotaAllows(db, userId, 'https://push.example/new')).toBe(false)
    expect(subscriptionQuotaAllows(db, userId, 'https://push.example/0')).toBe(true)
  })

  it('rejects a new endpoint over the wire and still accepts a re-subscription', async () => {
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_USER; i++) insertSub(`https://push.example/${i}`, i)
    const app = buildApp()
    const post = (endpoint: string) => app.request('/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(subscribePayload(endpoint)),
    })

    const rejected = await post('https://push.example/overflow')
    expect(rejected.status).toBe(429)
    expect((await rejected.json() as { code?: string }).code).toBe('quota')

    const accepted = await post('https://push.example/0')
    expect(accepted.status).toBe(201)
  })
})

describe('subscription rate limit', () => {
  it('blocks repeated attempts inside the window and recovers afterwards', () => {
    const now = 1_700_000_000_000
    let blockedAt = -1
    for (let i = 0; i < 40; i++) {
      if (subscribeRateLimited(db, userId, now + i)) { blockedAt = i; break }
    }
    expect(blockedAt).toBeGreaterThan(0)
    expect(subscribeRateLimited(db, userId, now + 61_000)).toBe(false)
  })

  it('answers 429 with a rate code when the same endpoint is hammered', async () => {
    const app = buildApp()
    let status = 0
    let code = ''
    for (let i = 0; i < 40; i++) {
      const res = await app.request('/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscribePayload('https://push.example/same')),
      })
      status = res.status
      if (status === 429) { code = (await res.json() as { code?: string }).code ?? ''; break }
    }
    expect(status).toBe(429)
    expect(code).toBe('rate')
  })
})

describe('bounded delivery', () => {
  it('never exceeds the configured concurrency', async () => {
    let active = 0
    let peak = 0
    _setSendFn(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
    })
    for (let i = 0; i < 12; i++) insertSub(`https://push.example/deliver-${i}`, i)

    await notifyUsers(db, [userId], 'tedee_offline', { nombre: 'Portal' }, { severity: 'critical' })

    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_PUSH)
  })

  it('mapWithConcurrency returns one settled result per item', async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      if (n === 3) throw new Error('boom')
      return n * 2
    })

    expect(results).toHaveLength(5)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4)
    expect(results[2].status).toBe('rejected')
  })
})
