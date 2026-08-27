// airbnb-sync.test.js — cruce del scraper de Airbnb: guests+amount por
// confirmation_code + aviso push de sesión muerta/recuperada (forzar: true).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../src/db.js'
import { aplicarCruce, syncAirbnb, crearPairing, pairingVigente, consumirPairing, guardarSesion } from '../src/airbnb-sync.js'

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
  process.env.AIRBNB_SESSION_PATH = join(dir, '.auth/airbnb_session.json')
  db = openDb(dir, 'test.db')
})
afterEach(() => {
  delete process.env.AIRBNB_DATA_DIR
  delete process.env.AIRBNB_SESSION_PATH
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

describe('pairing + guardarSesion', () => {
  it('crea un código de 6 caracteres vigente en kv con caducidad', () => {
    const p = crearPairing(db)
    expect(p.code).toMatch(/^[A-Z2-9]{6}$/)
    expect(p.expira).toBeGreaterThan(Date.now())
    const vigente = pairingVigente(db)
    expect(vigente.code).toBe(p.code)
  })

  it('pairingVigente devuelve null si está caducado', () => {
    crearPairing(db, Date.now() - 11 * 60 * 1000)
    expect(pairingVigente(db)).toBeNull()
  })

  it('consumirPairing: wrong code o expirado = false; correcto = true y single-use', () => {
    const p = crearPairing(db)
    expect(consumirPairing(db, 'XXXXXX')).toBe(false)
    expect(consumirPairing(db, p.code)).toBe(true)
    expect(pairingVigente(db)).toBeNull()
    expect(consumirPairing(db, p.code)).toBe(false)
  })

  it('guardarSesion escribe el storage_state en mode 600 en AIRBNB_SESSION_PATH', () => {
    const sesion = { cookies: [{ name: 'ucs', value: 'x' }, { name: 'datadome', value: 'y' }], origins: [] }
    const ruta = guardarSesion(sesion)
    expect(ruta).toBe(process.env.AIRBNB_SESSION_PATH)
    const escrito = JSON.parse(readFileSync(ruta, 'utf-8'))
    expect(escrito.cookies).toHaveLength(2)
    expect(escrito.cookies[1]).toEqual({ name: 'datadome', value: 'y' })
    const st = statSync(ruta)
    expect(st.mode & 0o777).toBe(0o600)
  })
})
