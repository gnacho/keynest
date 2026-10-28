import { randomInt } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DB } from '../src/db.js'
import { crearPairing } from '../src/airbnb-sync.js'

const source = readFileSync(new URL('../src/airbnb-sync.ts', import.meta.url), 'utf8')

describe('pairing codes', () => {
  it('uses a CSPRNG instead of Math.random', () => {
    expect(source).not.toMatch(/Math\.random/)
    expect(source).toMatch(/randomInt/)
  })

  it('generates six characters from the unambiguous alphabet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keynest-pairing-'))
    const db: DB = openDb(dir, 'test.db')
    try {
      const seen = new Set<string>()
      for (let i = 0; i < 50; i++) {
        const { code, expira } = crearPairing(db)
        expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
        expect(expira).toBeGreaterThan(Date.now())
        seen.add(code)
      }
      expect(seen.size).toBeGreaterThan(45)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('spreads characters across the alphabet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keynest-pairing-'))
    const db: DB = openDb(dir, 'test.db')
    try {
      const chars = new Set<string>()
      for (let i = 0; i < 200; i++) {
        for (const ch of crearPairing(db).code) chars.add(ch)
      }
      expect(chars.size).toBeGreaterThan(25)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps randomInt usage inside the alphabet bounds', () => {
    expect(source).toMatch(/randomInt\(PAIRING_ALPHABET\.length\)/)
    expect(randomInt(1)).toBe(0)
  })
})
