import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from '../src/db.js'
import type { DB } from '../src/db.js'
import { assignedSql, isAssignedTo, personProperties } from '../src/person-scope.js'

let dir: string
let db: DB

const token = 'fictitious-person-token-318'
const personId = 'person-assigned'
const otherId = 'person-unassigned'

beforeAll(() => {
  process.env.ENC_KEY = 'a'.repeat(64)
  process.env.SESSION_SECRET = 'c'.repeat(64)
  dir = mkdtempSync(join(tmpdir(), 'keynest-person-scope-'))
  db = openDb(dir, 'test.db')
  db.prepare('INSERT INTO people (id, name, token_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(personId, 'Fictitious cleaner', createHash('sha256').update(token).digest('hex'), 'limpieza', Date.now())
  db.prepare('INSERT INTO people (id, name, role, created_at) VALUES (?, ?, ?, ?)')
    .run(otherId, 'Other cleaner', 'limpieza', Date.now())
  const prop = db.prepare('INSERT INTO properties (id, slug, name, address, photo, instructions, checklist, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  prop.run('prop-assigned', 'prop-assigned', 'Assigned property', 'Fictitious street 1', '/photos/a.jpg', 'Fictitious instructions', '["Fictitious check"]', Date.now())
  prop.run('prop-unassigned', 'prop-unassigned', 'Unassigned property', 'Fictitious street 2', '/photos/b.jpg', 'Secret instructions', '["Other check"]', Date.now())
  const cleaning = db.prepare('INSERT INTO cleanings (id, property_id, date, status, checks, assignee_ids, photos, instructions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  cleaning.run('cleaning-live', 'prop-assigned', '2026-11-02', 'pendiente', '[]', JSON.stringify([personId]), '[]', 'Limpiar cocina', Date.now())
  cleaning.run('cleaning-foreign', 'prop-unassigned', '2026-11-03', 'pendiente', '[]', JSON.stringify([otherId]), '[]', 'Instrucciones de otro', Date.now())
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('person token property scope', () => {
  it('returns only the properties with live cleanings assigned to the person', () => {
    const props = personProperties(db, personId)

    expect(props.map((p) => p.id)).toEqual(['prop-assigned'])
  })

  it('exposes only the fields the cleaner needs', () => {
    const [prop] = personProperties(db, personId)

    expect(Object.keys(prop).sort()).toEqual(['address', 'checklist', 'id', 'instructions', 'name', 'photo'])
  })

  it('drops properties whose cleaning was archived or reassigned', () => {
    db.prepare("UPDATE cleanings SET status = 'archivada' WHERE id = 'cleaning-live'").run()
    expect(personProperties(db, personId)).toEqual([])

    db.prepare("UPDATE cleanings SET status = 'pendiente', assignee_ids = ? WHERE id = 'cleaning-live'").run(JSON.stringify([otherId]))
    expect(personProperties(db, personId)).toEqual([])
  })

  it('returns nothing for an unknown person', () => {
    expect(personProperties(db, 'person-unknown')).toEqual([])
  })

  it('ignores malformed assignment lists instead of leaking or crashing', () => {
    db.prepare("UPDATE cleanings SET status = 'pendiente', assignee_ids = ? WHERE id = 'cleaning-live'").run(JSON.stringify([personId]))
    db.prepare("UPDATE cleanings SET assignee_ids = ? WHERE id = 'cleaning-foreign'").run(JSON.stringify([otherId]))
    const insert = db.prepare('INSERT INTO cleanings (id, property_id, date, status, checks, assignee_ids, photos, instructions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    insert.run('cleaning-scalar', 'prop-unassigned', '2026-11-04', 'pendiente', '[]', JSON.stringify(personId), '[]', null, Date.now())
    insert.run('cleaning-broken', 'prop-unassigned', '2026-11-05', 'pendiente', '[]', '{"bad', '[]', null, Date.now())
    insert.run('cleaning-null', 'prop-unassigned', '2026-11-06', 'pendiente', '[]', null, '[]', null, Date.now())

    expect(personProperties(db, personId).map((p) => p.id)).toEqual(['prop-assigned'])

    db.prepare("DELETE FROM cleanings WHERE id IN ('cleaning-scalar', 'cleaning-broken', 'cleaning-null')").run()
  })

  it('lists same-person cleanings without crashing on malformed lists', () => {
    // La misma respuesta del enlace personal filtra las limpiezas con su propia
    // consulta: un JSON roto aquí devolvía 500 y dejaba a la persona sin página.
    const rows = db.prepare(
      `SELECT id FROM cleanings x WHERE x.status != 'archivada' AND ${assignedSql('x')} ORDER BY x.date`,
    ).all(personId) as Array<{ id: string }>
    expect(rows.map((r) => r.id)).toContain('cleaning-live')
    expect(rows.map((r) => r.id)).not.toContain('cleaning-foreign')

    const insert = db.prepare('INSERT INTO cleanings (id, property_id, date, status, checks, assignee_ids, photos, instructions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    insert.run('cleaning-broken-2', 'prop-assigned', '2026-11-07', 'pendiente', '[]', '{"bad', '[]', null, Date.now())
    insert.run('cleaning-scalar-2', 'prop-assigned', '2026-11-08', 'pendiente', '[]', JSON.stringify(personId), '[]', null, Date.now())

    const safe = db.prepare(
      `SELECT id FROM cleanings x WHERE x.status != 'archivada' AND ${assignedSql('x')} ORDER BY x.date`,
    ).all(personId) as Array<{ id: string }>
    expect(safe.map((r) => r.id)).toEqual(['cleaning-live'])

    db.prepare("DELETE FROM cleanings WHERE id IN ('cleaning-broken-2', 'cleaning-scalar-2')").run()
  })

  it('does not treat a broken or scalar assignment as ownership in memory', () => {
    expect(isAssignedTo(JSON.stringify([personId]), personId)).toBe(true)
    expect(isAssignedTo(JSON.stringify([otherId]), personId)).toBe(false)
    expect(isAssignedTo(JSON.stringify(personId), personId)).toBe(false)
    expect(isAssignedTo('{"bad', personId)).toBe(false)
    expect(isAssignedTo(null, personId)).toBe(false)
    expect(isAssignedTo('', personId)).toBe(false)
    expect(isAssignedTo(JSON.stringify([1, 2]), personId)).toBe(false)
  })
})
