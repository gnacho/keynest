// Dataset demo (#347): siembra con fechas relativas, estados de Airbnb y
// refresco automático cuando la siembra envejece.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { kvGet, openDb } from '../src/db.js'
import type { DB } from '../src/db.js'
import { DEMO_MAX_EDAD_MS, demoNecesitaReseed, demoSembradoEn, reseedDemo, seedDemo } from '../src/seed-demo.js'
import { recentCancellations } from '../src/cancellations.js'

const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

let dir: string
let db: DB

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-seed-demo-'))
  db = openDb(dir)
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function cuenta(tabla: string): number {
  return (db.prepare(`SELECT COUNT(*) n FROM ${tabla}`).get() as { n: number }).n
}

describe('seed de la demo (#347)', () => {
  it('siembra una sola vez, con fechas relativas a hoy y marca temporal', () => {
    expect(seedDemo(db)).toBe(true)
    expect(seedDemo(db)).toBe(false)
    expect(cuenta('properties')).toBe(5)
    expect(cuenta('reservations')).toBe(14)
    expect(cuenta('people')).toBe(4)
    expect(Number(kvGet(db, 'demo_seed_at'))).toBeGreaterThan(0)
    const rango = db.prepare('SELECT MIN(checkin) AS primera, MAX(checkout) AS ultima FROM reservations').get() as { primera: string; ultima: string }
    expect(rango.primera <= ymdLocal(new Date())).toBe(true)
    expect(rango.ultima > ymdLocal(new Date())).toBe(true)
  })

  it('incluye una solicitud pendiente, una cancelación solicitada y estados por fechas', () => {
    const solicitud = db.prepare("SELECT * FROM reservations WHERE airbnb_status = 'request'").all() as Array<{ confirmation_code: string }>
    expect(solicitud).toHaveLength(1)
    expect(solicitud[0].confirmation_code).toBe('HMDEMO1JJ1')
    expect(cuenta('reservations')).toBeGreaterThan(0)
    const estados = db.prepare('SELECT airbnb_status s, COUNT(*) n FROM reservations GROUP BY airbnb_status').all() as Array<{ s: string; n: number }>
    const porEstado = Object.fromEntries(estados.map((e) => [e.s, e.n]))
    expect(porEstado.complete).toBeGreaterThan(0)
    expect(porEstado.upcoming).toBeGreaterThan(0)
    expect(porEstado['']).toBeUndefined()
    const cancelacion = db.prepare("SELECT COUNT(*) n FROM reservations WHERE airbnb_cancellation_status = 'PENDING'").get() as { n: number }
    expect(cancelacion.n).toBe(1)
  })

  it('siembra plazos que suman el importe de la estancia larga', () => {
    const pagos = db.prepare("SELECT amount, status FROM reservation_payments WHERE confirmation_code = 'HMDEMO5NN5'").all() as Array<{ amount: number; status: string }>
    expect(pagos).toHaveLength(3)
    expect(pagos.reduce((acc, p) => acc + p.amount, 0)).toBeCloseTo(2400, 2)
    expect(pagos.filter((p) => p.status === 'PAID')).toHaveLength(1)
  })

  it('siembra una cancelación reciente que el aviso rojo puede leer', () => {
    const avisos = recentCancellations(db)
    expect(avisos).toHaveLength(1)
    expect(avisos[0].guestName).toBe('Nora Berger')
    expect(avisos[0].amount).toBeCloseTo(512.4, 2)
    expect(avisos[0].propertyName).toBe('Estudio Ruzafa')
  })
})

describe('refresco del dataset demo (#347)', () => {
  it('no resembra una siembra reciente', () => {
    const antes = demoSembradoEn(db)
    expect(demoNecesitaReseed(db)).toBe(false)
    expect(reseedDemo(db)).toBe(false)
    expect(demoSembradoEn(db)).toBe(antes)
  })

  it('detecta la vejez por la marca y, sin marca, por created_at', () => {
    db.prepare("UPDATE kv SET value = ? WHERE key = 'demo_seed_at'").run(String(Date.now() - DEMO_MAX_EDAD_MS - 1000))
    expect(demoNecesitaReseed(db)).toBe(true)
    db.prepare("DELETE FROM kv WHERE key = 'demo_seed_at'").run()
    db.prepare('UPDATE properties SET created_at = ?').run(Date.now() - 10 * 24 * 3600 * 1000)
    expect(demoSembradoEn(db)).toBeLessThan(Date.now() - 9 * 24 * 3600 * 1000)
    expect(demoNecesitaReseed(db)).toBe(true)
  })

  it('resembra sin duplicar filas y conserva el usuario demo', () => {
    const idsAntes = (db.prepare('SELECT id FROM properties').all() as Array<{ id: string }>).map((r) => r.id)
    db.prepare('UPDATE properties SET created_at = ?').run(Date.now() - 10 * 24 * 3600 * 1000)
    expect(reseedDemo(db)).toBe(true)
    expect(cuenta('properties')).toBe(5)
    expect(cuenta('reservations')).toBe(14)
    expect(cuenta('users')).toBe(1)
    const idsDespues = (db.prepare('SELECT id FROM properties').all() as Array<{ id: string }>).map((r) => r.id)
    expect(idsDespues).not.toEqual(idsAntes)
    const futuras = db.prepare('SELECT COUNT(*) n FROM reservations WHERE checkout >= ?').get(ymdLocal(new Date())) as { n: number }
    expect(futuras.n).toBeGreaterThan(0)
    expect(recentCancellations(db)).toHaveLength(1)
    expect(reseedDemo(db)).toBe(false)
  })
})
