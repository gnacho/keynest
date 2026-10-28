import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensurePrivateDir, openDb, type DB } from '../src/db.js'

let dir: string
let db: DB

function mode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8)
}

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'keynest-perms-')), 'data')
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('data directory permissions', () => {
  it('creates the data directory readable only by its owner', () => {
    db = openDb(dir, 'keynest.db')
    expect(mode(dir)).toBe('700')
  })

  it('creates database files readable only by their owner', () => {
    db = openDb(dir, 'keynest.db')
    expect(mode(join(dir, 'keynest.db'))).toBe('600')
  })

  it('tightens an existing too-open data directory', () => {
    openDb(dir, 'keynest.db').close()
    chmodSync(dir, 0o755)
    chmodSync(join(dir, 'keynest.db'), 0o644)

    db = openDb(dir, 'keynest.db')

    expect(mode(dir)).toBe('700')
    expect(mode(join(dir, 'keynest.db'))).toBe('600')
  })

  it('creates photo and avatar directories readable only by their owner', () => {
    db = openDb(dir, 'keynest.db')
    const previous = process.umask(0o002)

    try {
      ensurePrivateDir(join(dir, 'photos'))
      ensurePrivateDir(join(dir, 'avatars'))
    } finally {
      process.umask(previous)
    }

    expect(mode(join(dir, 'photos'))).toBe('700')
    expect(mode(join(dir, 'avatars'))).toBe('700')
  })

  it('tightens an existing photo directory created with the system umask', () => {
    mkdirSync(join(dir), { recursive: true })
    const previous = process.umask(0o002)
    try {
      mkdirSync(join(dir, 'photos'), { recursive: true })
    } finally {
      process.umask(previous)
    }
    expect(mode(join(dir, 'photos'))).toBe('775')

    ensurePrivateDir(join(dir, 'photos'))

    expect(mode(join(dir, 'photos'))).toBe('700')
  })
})
