import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, encryptSecret, type DB } from '../src/db.js'
import { workOrderPayload } from '../src/work-order.js'

let dir: string
let db: DB
const oldKey = process.env.ENC_KEY

const PROPERTY = { id: 'prop-1', name: 'Fictitious flat', address: 'Fictitious street', photo: '', instructions: 'Fictitious instructions' }
const PERSON = { id: 'person-1', name: 'Fictitious cleaner', phone: '600000000', specialty: 'limpieza', hourly_rate: 12.5 }

function seedTask(extra: Record<string, unknown> = {}) {
  const token = 'fictitious-work-order-token'
  db.prepare(`INSERT INTO maintenance_tasks (id, property_id, title, checks, photos, assignee_id, token_cipher, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('task-1', PROPERTY.id, 'Fictitious task', '["check-a"]', '[]', PERSON.id, encryptSecret(db, token), Date.now())
  const task = db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get('task-1') as Record<string, unknown>
  return { ...task, ...extra }
}

beforeEach(() => {
  process.env.ENC_KEY = 'b'.repeat(64)
  dir = mkdtempSync(join(tmpdir(), 'keynest-workorder-'))
  db = openDb(dir, 'test.db')
  db.prepare('INSERT INTO properties (id, slug, name, address, photo, instructions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(PROPERTY.id, 'fictitious-flat', PROPERTY.name, PROPERTY.address, PROPERTY.photo, PROPERTY.instructions, Date.now())
  db.prepare('INSERT INTO people (id, name, phone, role, specialty, hourly_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(PERSON.id, PERSON.name, PERSON.phone, 'proveedor', PERSON.specialty, PERSON.hourly_rate, Date.now())
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  if (oldKey === undefined) delete process.env.ENC_KEY
  else process.env.ENC_KEY = oldKey
})

describe('work order payload', () => {
  it('never returns the stored token ciphertext or the assignee rate', () => {
    const payload = workOrderPayload(seedTask(), PROPERTY, PERSON)

    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('token_cipher')
    expect(serialized).not.toContain('hourly_rate')
    expect(serialized).not.toContain('gcm:')
    expect((payload.assignee as Record<string, unknown>).hourly_rate).toBeUndefined()
    expect((payload.task as Record<string, unknown>).token_cipher).toBeUndefined()
  })

  it('keeps the fields the provider page needs', () => {
    const payload = workOrderPayload(seedTask(), PROPERTY, PERSON)

    expect(payload.task).toMatchObject({ id: 'task-1', title: 'Fictitious task', checks: ['check-a'], photos: [] })
    expect((payload.assignee as Record<string, unknown>).name).toBe(PERSON.name)
    expect((payload.property as Record<string, unknown>).address).toBe(PROPERTY.address)
  })

  it('accepts a missing assignee', () => {
    const payload = workOrderPayload(seedTask(), PROPERTY, null)
    expect(payload.assignee).toBeNull()
  })

  it('returns every field the provider page renders', () => {
    const page = readFileSync(new URL('../../app/src/pages/MantenimientoToken.tsx', import.meta.url), 'utf8')
    const block = page.split('interface WoTask {')[1].split('}')[0]
    const declared = [...block.matchAll(/^\s{2}([a-z_]+)\??:/gm)].map((match) => match[1])
    expect(declared.length).toBeGreaterThan(5)

    const task = {
      ...seedTask(),
      category: 'fontanería',
      urgent: 1,
      notes: 'Fictitious notes',
      scheduled_date: '2026-11-02',
      cost: 45.5,
    }
    const payload = workOrderPayload(task, PROPERTY, PERSON)

    for (const field of declared) {
      expect(payload.task as Record<string, unknown>, field).toHaveProperty(field)
    }
    expect(payload.task).toMatchObject({ category: 'fontanería', urgent: 1, notes: 'Fictitious notes', scheduled_date: '2026-11-02', cost: 45.5 })
    expect(JSON.stringify(payload)).not.toContain('token_cipher')
    expect(JSON.stringify(payload)).not.toContain('hourly_rate')
  })
})
