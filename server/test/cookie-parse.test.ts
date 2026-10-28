import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from 'hono'
import { openDb, kvSet, type DB } from '../src/db.js'
import { sessionFromCookie } from '../src/auth.js'

let dir: string
let db: DB
const oldSecret = process.env.SESSION_SECRET

function ctx(cookie: string): Context {
  return { req: { raw: { headers: new Headers({ cookie }) } } } as unknown as Context
}

beforeEach(() => {
  process.env.SESSION_SECRET = 's'.repeat(64)
  dir = mkdtempSync(join(tmpdir(), 'keynest-cookie-'))
  db = openDb(dir, 'test.db')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  if (oldSecret === undefined) delete process.env.SESSION_SECRET
  else process.env.SESSION_SECRET = oldSecret
})

describe('session cookie parsing', () => {
  it('rejects a truncated signature without throwing', () => {
    kvSet(db, 'probe', '1')
    expect(sessionFromCookie(db, ctx('keynest_session=abc.abc'))).toBeNull()
  })

  it('rejects an overlong signature without throwing', () => {
    expect(sessionFromCookie(db, ctx(`keynest_session=abc.${'a'.repeat(200)}`))).toBeNull()
  })

  it('rejects an empty signature without throwing', () => {
    expect(sessionFromCookie(db, ctx('keynest_session=abc.'))).toBeNull()
  })

  it('rejects non-ascii signature bytes without throwing', () => {
    expect(sessionFromCookie(db, ctx('keynest_session=abc.ñññ'))).toBeNull()
  })

  it('rejects a cookie without a separator', () => {
    expect(sessionFromCookie(db, ctx('keynest_session=abcdef'))).toBeNull()
  })
})
