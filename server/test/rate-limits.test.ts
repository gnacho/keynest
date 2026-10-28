import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/db.js'
import { cleanExpiredRateLimits } from '../src/auth.js'

let dir: string
let db: DB

function seedRateLimit(key: string, windowEnd: number): void {
  db.prepare('INSERT INTO rate_limits (key, count, window_end) VALUES (?, ?, ?)').run(key, 10, windowEnd)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-rate-limits-'))
  db = openDb(dir, 'test.db')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('rate limit retention', () => {
  it('removes windows that already expired', () => {
    const now = Date.now()
    seedRateLimit('airbnb:pairing:203.0.113.1', now - 60_000)
    seedRateLimit('photo:token:203.0.113.2', now - 1_000)

    expect(cleanExpiredRateLimits(db)).toBe(2)

    const left = db.prepare('SELECT COUNT(*) count FROM rate_limits').get() as { count: number }
    expect(left.count).toBe(0)
  })

  it('keeps windows still in force', () => {
    const now = Date.now()
    seedRateLimit('airbnb:pairing:203.0.113.3', now + 30_000)
    seedRateLimit('sync:203.0.113.4', now - 1)

    expect(cleanExpiredRateLimits(db)).toBe(1)

    const rows = db.prepare('SELECT key FROM rate_limits').all() as Array<{ key: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('airbnb:pairing:203.0.113.3')
  })
})
