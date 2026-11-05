import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { openDb } from '../src/db.js'
import type { DB, UserRow } from '../src/db.js'
import { cancelBooking } from '../src/cancel-booking.js'
import { CANCELLATION_LIMIT, recentCancellations } from '../src/cancellations.js'
import { registerCancellationRoutes } from '../src/routes-cancellations.js'

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const daysFrom = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d
}

let dir: string
let db: DB

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-cancellations-'))
  db = openDb(dir)
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  db.prepare('DELETE FROM audit_log').run()
  db.prepare('DELETE FROM reservation_payments').run()
  db.prepare('DELETE FROM cleanings').run()
  db.prepare('DELETE FROM reservations').run()
  db.prepare('DELETE FROM properties').run()
  db.prepare("INSERT INTO properties (id, slug, name, ical_url, created_at) VALUES ('p1','p1','El 47','http://feed.test/ical.ics',0)").run()
})

function insertReservation(id: string, opts: { uid?: string; code?: string; guest?: string; amount?: number } = {}) {
  db.prepare(
    `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, guest_name, amount, created_at)
     VALUES (?, 'p1', ?, ?, ?, 'Reserved', ?, ?, ?, 0)`
  ).run(
    id,
    opts.uid ?? `${id}@airbnb.com`,
    ymd(daysFrom(10)),
    ymd(daysFrom(20)),
    opts.code ?? `CODE${id}`,
    opts.guest ?? 'Lisa Buchter',
    opts.amount ?? 5434.3,
  )
}

describe('recentCancellations', () => {
  it('devuelve el contenido del aviso a partir de la fila de audit_log', () => {
    insertReservation('r1', { code: 'HM5ZWXMCJK', guest: 'Lisa Buchter', amount: 5434.3 })

    const cancelada = cancelBooking(db, 'r1')
    expect(cancelada).not.toBeNull()

    const avisos = recentCancellations(db)
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatchObject({
      propertyId: 'p1',
      propertyName: 'El 47',
      guestName: 'Lisa Buchter',
      summary: 'Reserved',
      checkin: ymd(daysFrom(10)),
      checkout: ymd(daysFrom(20)),
      amount: 5434.3,
    })
    expect(avisos[0].id).toBeGreaterThan(0)
    expect(avisos[0].cancelledAt).toBeGreaterThan(Date.now() - 60_000)
  })

  it('deja fuera las cancelaciones mas antiguas que la ventana', () => {
    const ahora = Date.now()
    const vieja = ahora - 8 * 24 * 3600 * 1000
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail, at)
       VALUES (NULL, 'cancel', 'reservation', 'r-vieja', ?, ?)`
    ).run(JSON.stringify({ checkin: '2027-01-04', checkout: '2027-01-10', summary: 'Reserved', guest_name: 'Antigua', amount: 100 }), vieja)
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail, at)
       VALUES (NULL, 'cancel', 'reservation', 'r-reciente', ?, ?)`
    ).run(JSON.stringify({ checkin: '2027-02-04', checkout: '2027-02-10', summary: 'Reserved', guest_name: 'Reciente', amount: 200 }), ahora - 1000)

    const avisos = recentCancellations(db, { now: ahora })
    expect(avisos).toHaveLength(1)
    expect(avisos[0].guestName).toBe('Reciente')
  })

  it('tolera filas antiguas sin propiedad y descarta las de JSON invalido', () => {
    const ahora = Date.now()
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail, at)
       VALUES (NULL, 'cancel', 'reservation', 'r-sin-propiedad', ?, ?)`
    ).run(JSON.stringify({ checkin: '2027-03-01', checkout: '2027-03-05', summary: 'Reserved', amount: 0 }), ahora - 3000)
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail, at)
       VALUES (NULL, 'cancel', 'reservation', 'r-rota', 'no-es-json', ?)`
    ).run(ahora - 2000)

    const avisos = recentCancellations(db, { now: ahora })
    expect(avisos).toHaveLength(1)
    expect(avisos[0].propertyName).toBe('')
    expect(avisos[0].propertyId).toBe('')
    expect(avisos[0].guestName).toBe('')
    expect(avisos[0].amount).toBe(0)
  })

  it('respeta el limite de filas y ordena de la mas reciente a la mas antigua', () => {
    const ahora = Date.now()
    const insert = db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail, at)
       VALUES (NULL, 'cancel', 'reservation', ?, ?, ?)`
    )
    for (let i = 0; i < 25; i++) {
      insert.run(`r${i}`, JSON.stringify({ summary: `Reserva ${i}` }), ahora - i * 1000)
    }
    const avisos = recentCancellations(db, { now: ahora })
    expect(avisos).toHaveLength(CANCELLATION_LIMIT)
    expect(avisos[0].summary).toBe('Reserva 0')
    expect(avisos[1].summary).toBe('Reserva 1')
  })

  it('ignora otras acciones del audit log', () => {
    const ahora = Date.now()
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail, at)
       VALUES (NULL, 'update', 'reservation', 'r1', '{}', ?)`
    ).run(ahora)
    expect(recentCancellations(db, { now: ahora })).toEqual([])
  })
})

describe('GET /cancellations/recent', () => {
  it('responde con la lista de avisos leida de audit_log', async () => {
    insertReservation('r2', { guest: 'Marta Ruiz', amount: 980 })
    cancelBooking(db, 'r2')

    const app = new Hono<{ Bindings: { incoming?: { socket?: { remoteAddress?: string } } }; Variables: { db: DB; user: UserRow } }>()
    // Doble del middleware de sesion: fija la BD y el usuario que usaria guarded.
    app.use('*', async (c, next) => {
      c.set('db', db)
      c.set('user', { id: 'u1', username: 'u1' } as UserRow)
      await next()
    })
    registerCancellationRoutes(app)

    const res = await app.request('/cancellations/recent')
    expect(res.status).toBe(200)
    const body = await res.json() as { cancellations: Array<Record<string, unknown>> }
    expect(body.cancellations).toHaveLength(1)
    expect(body.cancellations[0]).toMatchObject({
      propertyName: 'El 47',
      guestName: 'Marta Ruiz',
      amount: 980,
    })
    expect(typeof body.cancellations[0].id).toBe('number')
    expect(typeof body.cancellations[0].cancelledAt).toBe('number')
  })
})
