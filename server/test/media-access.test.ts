import { createHmac } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/db.js'
import type { AppEnv } from '../src/auth.js'
import {
  registerMediaRoutes,
  resolveMediaFile,
  signMediaPath,
  signMediaPayload,
  verifyMediaSignature,
} from '../src/media.js'

const SECOND = 1000
const SECRET = 'm'.repeat(64)

let dir: string
let dataDir: string
let prodDb: DB
let demoDb: DB
let oldSecret: string | undefined

function photoFile(name = 'property-1.jpg', body = 'jpeg-bytes'): string {
  const photos = join(dataDir, 'photos')
  mkdirSync(photos, { recursive: true })
  const file = join(photos, name)
  writeFileSync(file, body)
  return file
}

function sessionCookie(userId: string, id = 'session-1'): string {
  prodDb.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo) VALUES (?, ?, ?, ?, ?, 0)')
    .run(id, userId, Date.now(), Date.now() + 60 * SECOND, '')
  const mac = createHmac('sha256', SECRET).update(id).digest('hex')
  return `keynest_session=${id}.${mac}`
}

function seededUser(username = 'media-admin'): string {
  const id = `user-${username}`
  prodDb.prepare('INSERT INTO users (id, username, password_hash, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, username, 'not-a-real-hash', 'auto', 'admin', Date.now())
  return id
}

function demoSessionCookie(id = 'demo-session-1'): string {
  demoDb.prepare('INSERT INTO users (id, username, password_hash, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('demo-user', 'demo', 'not-a-real-hash', 'auto', 'demo', Date.now())
  prodDb.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo) VALUES (?, ?, ?, ?, ?, 1)')
    .run(id, 'demo-user', Date.now(), Date.now() + 60 * SECOND, '')
  const mac = createHmac('sha256', SECRET).update(id).digest('hex')
  return `keynest_session=${id}.${mac}`
}

function app(): Hono<AppEnv> {
  const instance = new Hono<AppEnv>()
  registerMediaRoutes(instance, { dataDir, prodDb, demoDb })
  instance.get('*', (c) => c.html('<html>app shell</html>'))
  return instance
}

beforeEach(() => {
  oldSecret = process.env.SESSION_SECRET
  process.env.SESSION_SECRET = SECRET
  dir = mkdtempSync(join(tmpdir(), 'keynest-media-'))
  dataDir = join(dir, 'data')
  mkdirSync(dataDir, { recursive: true })
  prodDb = openDb(dir, 'keynest.db')
  demoDb = openDb(dir, 'keynest_demo.db')
})

afterEach(() => {
  prodDb.close()
  demoDb.close()
  rmSync(dir, { recursive: true, force: true })
  if (oldSecret === undefined) delete process.env.SESSION_SECRET
  else process.env.SESSION_SECRET = oldSecret
})

describe('media signatures', () => {
  it('signs a media path and validates it', () => {
    const signed = signMediaPath('/photos/property-1.jpg')
    const url = new URL(signed, 'http://127.0.0.1')
    expect(url.pathname).toBe('/photos/property-1.jpg')
    expect(url.searchParams.get('exp')).toBeTruthy()
    expect(url.searchParams.get('sig')).toBeTruthy()
    expect(verifyMediaSignature('/photos/property-1.jpg', url.searchParams.get('exp'), url.searchParams.get('sig'))).toBe(true)
  })

  it('rejects an expired signature', () => {
    const now = Date.now()
    const signed = signMediaPath('/photos/property-1.jpg', { ttlMs: 5 * SECOND, now })
    const url = new URL(signed, 'http://127.0.0.1')
    expect(verifyMediaSignature('/photos/property-1.jpg', url.searchParams.get('exp'), url.searchParams.get('sig'), now + 10 * SECOND)).toBe(false)
  })

  it('rejects a signature reused for another file', () => {
    const signed = signMediaPath('/photos/property-1.jpg')
    const url = new URL(signed, 'http://127.0.0.1')
    expect(verifyMediaSignature('/photos/other-2.jpg', url.searchParams.get('exp'), url.searchParams.get('sig'))).toBe(false)
  })

  it('rejects tampered or missing signatures without throwing', () => {
    const signed = signMediaPath('/photos/property-1.jpg')
    const url = new URL(signed, 'http://127.0.0.1')
    const sig = url.searchParams.get('sig')!
    expect(verifyMediaSignature('/photos/property-1.jpg', url.searchParams.get('exp'), `${sig.slice(0, -1)}x`)).toBe(false)
    expect(verifyMediaSignature('/photos/property-1.jpg', url.searchParams.get('exp'), 'short')).toBe(false)
    expect(verifyMediaSignature('/photos/property-1.jpg', undefined, undefined)).toBe(false)
  })

  it('signs only media paths inside a payload and never double-signs', () => {
    const payload = {
      properties: [{ id: 'p1', name: 'Piso', photo: '/photos/property-1.jpg', checklist: ['/photos/not-a-photo.jpg'] }],
      cleanings: [{ photos: ['/photos/clean-1.jpg', '/prop-carmen.svg'] }, { photos: '["/photos/clean-2.jpg"]' }],
      user: { avatar: '/avatars/user-1.png', name: 'Ana' },
      token: 'plain-token',
    }

    const signed = signMediaPayload(payload)

    expect(signed.properties[0].photo).toMatch(/^\/photos\/property-1\.jpg\?exp=\d+&sig=/)
    expect(signed.properties[0].checklist[0]).toBe('/photos/not-a-photo.jpg')
    expect(signed.cleanings[0].photos[0]).toMatch(/^\/photos\/clean-1\.jpg\?/)
    expect(signed.cleanings[0].photos[1]).toBe('/prop-carmen.svg')
    expect(signed.cleanings[1].photos).toEqual([expect.stringMatching(/^\/photos\/clean-2\.jpg\?exp=\d+&sig=/)])
    expect(signed.user.avatar).toMatch(/^\/avatars\/user-1\.png\?/)
    expect(signed.token).toBe('plain-token')
    expect(signMediaPayload(signed).properties[0].photo).toBe(signed.properties[0].photo)
  })
})

describe('media file resolution', () => {
  it('resolves a real photo and a real avatar', () => {
    photoFile()
    mkdirSync(join(dataDir, 'avatars'))
    writeFileSync(join(dataDir, 'avatars', 'user-1.png'), 'png-bytes')

    expect(resolveMediaFile(dataDir, '/photos/property-1.jpg')).toEqual({
      file: join(dataDir, 'photos', 'property-1.jpg'),
      contentType: 'image/jpeg',
    })
    expect(resolveMediaFile(dataDir, '/avatars/user-1.png')).toEqual({
      file: join(dataDir, 'avatars', 'user-1.png'),
      contentType: 'image/png',
    })
  })

  it('refuses traversal, unknown extensions and absolute escapes', () => {
    writeFileSync(join(dataDir, 'outside.txt'), 'keep')
    expect(resolveMediaFile(dataDir, '/photos/../outside.txt')).toBeNull()
    expect(resolveMediaFile(dataDir, '/photos/..%2Foutside.txt')).toBeNull()
    expect(resolveMediaFile(dataDir, '/photos/evil.svg')).toBeNull()
    expect(resolveMediaFile(dataDir, '/photos/evil.html')).toBeNull()
    expect(resolveMediaFile(dataDir, '/other/property-1.jpg')).toBeNull()
  })

  it('refuses a symlinked file and a symlinked media directory', () => {
    const outside = join(dir, 'outside-1.jpg')
    writeFileSync(outside, 'keep')
    mkdirSync(join(dataDir, 'photos'))
    symlinkSync(outside, join(dataDir, 'photos', 'linked.jpg'))
    expect(resolveMediaFile(dataDir, '/photos/linked.jpg')).toBeNull()

    rmSync(join(dataDir, 'photos'), { recursive: true, force: true })
    const outsideDir = join(dir, 'outside-photos')
    mkdirSync(outsideDir)
    writeFileSync(join(outsideDir, 'victim.jpg'), 'keep')
    symlinkSync(outsideDir, join(dataDir, 'photos'))
    expect(resolveMediaFile(dataDir, '/photos/victim.jpg')).toBeNull()
  })
})

describe('media routes', () => {
  it('refuses anonymous access to photos and avatars', async () => {
    photoFile()
    mkdirSync(join(dataDir, 'avatars'))
    writeFileSync(join(dataDir, 'avatars', 'user-1.png'), 'png-bytes')

    expect((await app().request('/photos/property-1.jpg')).status).toBe(401)
    expect((await app().request('/avatars/user-1.png')).status).toBe(401)
  })

  it('serves media to an authenticated session with safe headers', async () => {
    photoFile()
    const userId = seededUser()

    const response = await app().request('/photos/property-1.jpg', { headers: { cookie: sessionCookie(userId) } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(await response.text()).toBe('jpeg-bytes')
  })

  it('serves media to an anonymous request with a valid signature', async () => {
    photoFile()
    const signed = signMediaPath('/photos/property-1.jpg')

    const response = await app().request(signed)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('jpeg-bytes')
  })

  it('rejects expired signatures and signatures reused for another file', async () => {
    photoFile('property-1.jpg')
    photoFile('property-2.jpg')
    const now = Date.now()
    const expired = signMediaPath('/photos/property-1.jpg', { ttlMs: -10 * SECOND, now })
    const otherPath = signMediaPath('/photos/property-2.jpg')
    const otherUrl = new URL(otherPath, 'http://127.0.0.1')

    expect((await app().request(expired)).status).toBe(401)
    const swapped = `/photos/property-1.jpg?exp=${otherUrl.searchParams.get('exp')}&sig=${otherUrl.searchParams.get('sig')}`
    expect((await app().request(swapped)).status).toBe(401)
  })

  it('does not let an anonymous demo session read real media', async () => {
    photoFile()
    const cookie = demoSessionCookie()

    expect((await app().request('/photos/property-1.jpg', { headers: { cookie } })).status).toBe(401)
    expect((await app().request(signMediaPath('/photos/property-1.jpg'), { headers: { cookie } })).status).toBe(200)
  })

  it('uses a long cache for immutable photo names and none for stable avatars', async () => {
    photoFile()
    mkdirSync(join(dataDir, 'avatars'))
    writeFileSync(join(dataDir, 'avatars', 'user-1.png'), 'png-bytes')
    const cookie = sessionCookie(seededUser())

    const photo = await app().request('/photos/property-1.jpg', { headers: { cookie } })
    const avatar = await app().request('/avatars/user-1.png', { headers: { cookie } })

    expect(photo.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(avatar.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('warns when a media directory is a symbolic link', () => {
    const outsideDir = join(dir, 'outside-photos')
    mkdirSync(outsideDir)
    symlinkSync(outsideDir, join(dataDir, 'photos'))
    const warnings: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')) }
    try {
      app()
    } finally {
      console.warn = original
    }

    expect(warnings.some((line) => line.includes('photos'))).toBe(true)
  })

  it('answers 401 to anonymous requests for missing files instead of leaking existence', async () => {
    expect((await app().request('/photos/ghost.jpg')).status).toBe(401)
    expect((await app().request(signMediaPath('/photos/ghost.jpg'))).status).toBe(404)
  })

  it('returns 404 for a missing file and for a rejected path', async () => {
    const userId = seededUser()
    const missing = sessionCookie(userId, 'session-missing')
    const traversal = sessionCookie(userId, 'session-traversal')
    expect((await app().request('/photos/ghost.jpg', { headers: { cookie: missing } })).status).toBe(404)
    expect((await app().request('/photos/%2e%2e%2foutside.txt', { headers: { cookie: traversal } })).status).toBe(404)
  })

  it('does not mark a failed read as cacheable', async () => {
    const file = photoFile()
    chmodSync(file, 0o000)
    try {
      const cookie = sessionCookie(seededUser())
      const response = await app().request('/photos/property-1.jpg', { headers: { cookie } })
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBeNull()
    } finally {
      chmodSync(file, 0o644)
    }
  })

  it('does not let nested media paths fall through to the app shell', async () => {
    const nested = await app().request('/photos/nested/photo.jpg')
    expect(nested.status).toBe(404)
    expect(await nested.text()).toBe('no encontrado')
  })
})
