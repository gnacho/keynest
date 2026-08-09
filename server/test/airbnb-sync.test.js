// airbnb-sync.test.js — cruce del scraper de Airbnb: guests+amount por
// confirmation_code + aviso push de sesión muerta/recuperada (forzar: true).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../src/db.js'
import { aplicarCruce, syncAirbnb } from '../src/airbnb-sync.js'

// notifyAll de push.js se mockea para capturar los avisos de sesión.
vi.mock('../src/push.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, notifyAll: vi.fn(() => Promise.resolve()) }
})
import { notifyAll } from '../src/push.js'

let dir
let dataDir
let db
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-airbnb-test-'))
  dataDir = join(dir, 'data')
  mkdirSync(dataDir, { recursive: true })
  process.env.AIRBNB_DATA_DIR = dataDir
  db = openDb(dir, 'test.db')
})
afterEach(() => {
  delete process.env.AIRBNB_DATA_DIR
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.clearAllMocks()
})

function escribeReservas(reservas) {
  writeFileSync(join(dataDir, 'airbnb_reservas.json'), JSON.stringify({ extraido: new Date().toISOString(), reservas }))
}
function escribeSesion(viva, detalle) {
  writeFileSync(join(dataDir, 'airbnb_sesion.json'), JSON.stringify({ viva, detalle: detalle ?? null }))
}
function insertaReserva(id, code) {
  db.prepare(
    `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, created_at)
     VALUES (?, 'p1', ?, '2026-08-10', '2026-08-12', 'A', ?, ?)`,
  ).run(id, `uid-${id}`, code, Date.now())
}

describe('aplicarCruce', () => {
  it('actualiza guests y amount por confirmation_code y cuenta sinMatch', () => {
    insertaReserva('res-1', 'HM1')
    escribeReservas([
      { confirmation_code: 'HM1', guests: 3, amount: 220.5 },
      { confirmation_code: 'HM-NO-EXISTE', guests: 2, amount: 100 },
    ])
    const res = aplicarCruce(db)
    expect(res.cruzadas).toBe(1)
    expect(res.sinMatch).toBe(1)
    const fila = db.prepare('SELECT guests, amount FROM reservations WHERE id = ?').get('res-1')
    expect(fila.guests).toBe(3)
    expect(fila.amount).toBe(220.5)
  })
})

describe('syncAirbnb', () => {
  it('avisa push crítico (forzar) en el flanco viva->muerta', async () => {
    insertaReserva('res-1', 'HM1')
    escribeReservas([{ confirmation_code: 'HM1', guests: 3, amount: 200 }])
    escribeSesion(false, 'sesión caducada')
    await syncAirbnb(db)
    expect(notifyAll).toHaveBeenCalledWith(
      expect.anything(),
      'airbnb_sesion_caida',
      expect.objectContaining({ detalle: 'sesión caducada' }),
      expect.objectContaining({ severity: 'critical', forzar: true }),
    )
  })

  it('avisa recuperación en el flanco muerta->viva', async () => {
    insertaReserva('res-1', 'HM1')
    escribeReservas([{ confirmation_code: 'HM1', guests: 3, amount: 200 }])
    // Estado previo guardado: sesión muerta (para provocar el flanco).
    db.prepare(`INSERT INTO kv (key, value) VALUES ('airbnb_sesion', ?)`).run(JSON.stringify({ viva: false }))
    escribeSesion(true)
    await syncAirbnb(db)
    expect(notifyAll).toHaveBeenCalledWith(
      expect.anything(),
      'airbnb_sesion_ok',
      expect.anything(),
      expect.objectContaining({ severity: 'normal' }),
    )
  })
})
