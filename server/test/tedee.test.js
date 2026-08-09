import crypto from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, kvSet } from '../src/db.js'
import { tedeeAccesses, tedeeLocks } from '../src/tedee.js'

const ENC_KEY = crypto.randomBytes(32)
process.env.ENC_KEY = ENC_KEY.toString('hex')

let dir
let db
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-tedee-test-'))
  db = openDb(dir, 'test.db')
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Cifra un token con ENC_KEY para que decryptSecret lo descifre en tests. */
function tokenCifrado(plain = 'test-token') {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv)
  let ct = cipher.update(plain, 'utf8')
  ct = Buffer.concat([ct, cipher.final()])
  const tag = cipher.getAuthTag()
  return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
}

function configurarTedeeCloud(db, url = 'https://api.tedee.com') {
  kvSet(db, 'tedee_url', url)
  kvSet(db, 'tedee_token', tokenCifrado())
}

function configurarTedeeBridge(db, url = 'http://192.168.1.50') {
  kvSet(db, 'tedee_url', url)
  kvSet(db, 'tedee_token', tokenCifrado())
}

function mockResponse(json, status = 200) {
  fetch.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => json })
}

const cloudLock = {
  id: 176718, name: 'Portal', isConnected: true,
  deviceState: { batteryLevel: 85, state: 2 }, serialNumber: 'SN-001',
}

function insertarPropiedad(lockId) {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO properties (id, slug, name, address, bedrooms, bathrooms, area, photo, checklist, instructions, created_at, tedee_lock_id)
     VALUES (?, 'prop', 'Mi Propiedad', 'Calle 1', 1, 1, 50, '', '[]', '', ?, ?)`,
  ).run(id, new Date().toISOString(), lockId)
  return id
}

describe('tedeeAccesses', () => {
  it('devuelve [] cuando la url no es cloud (bridge local)', async () => {
    configurarTedeeBridge(db)
    const acc = await tedeeAccesses(db)
    expect(acc).toEqual([])
  })

  it('devuelve [] cuando no hay URL configurada', async () => {
    kvSet(db, 'tedee_url', '')
    kvSet(db, 'tedee_token', tokenCifrado())
    const acc = await tedeeAccesses(db)
    expect(acc).toEqual([])
  })

  it('devuelve [] cuando no hay cerraduras', async () => {
    configurarTedeeCloud(db)
    mockResponse({ result: [] }) // locks vacío
    const acc = await tedeeAccesses(db)
    expect(acc).toEqual([])
  })

  it('devuelve [] cuando las cerraduras no tienen actividad', async () => {
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] }) // locks
    mockResponse({ result: [] }) // deviceactivity vacío
    const acc = await tedeeAccesses(db)
    expect(acc).toEqual([])
  })

  it('mapea PIN unlock → entrada, keypad lock → salida, orden descendente', async () => {
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({
      result: [
        { id: 1, event: 61, date: '2026-08-09T10:00:00Z', pinAlias: 'Ana' },
        { id: 2, event: 65, date: '2026-08-09T12:00:00Z', username: 'Ana' },
      ],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(2)
    expect(acc[0].type).toBe('salida')   // más reciente primero
    expect(acc[0].at.getTime()).toBe(new Date('2026-08-09T12:00:00Z').getTime())
    expect(acc[0].actorName).toBe('Ana')
    expect(acc[0].actorRole).toBe('huésped')
    expect(acc[0].lockId).toBe('176718')
    expect(acc[0].id).toBe('td-2')
    expect(acc[1].type).toBe('entrada')
    expect(acc[1].id).toBe('td-1')
  })

  it('eventos de app → remota, sin actor → propietario', async () => {
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({
      result: [{ id: 3, event: 32, date: '2026-08-09T14:00:00Z' }],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(1)
    expect(acc[0].type).toBe('remota')
    expect(acc[0].actorRole).toBe('propietario')
    expect(acc[0].actorName).toBe('')
  })

  it('huella → entrada', async () => {
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({
      result: [
        { id: 10, event: 77, date: '2026-08-09T09:00:00Z', username: 'Carlos' },
        { id: 11, event: 79, date: '2026-08-09T09:05:00Z', username: 'Diana' },
      ],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(2)
    expect(acc.every((a) => a.type === 'entrada')).toBe(true)
  })

  it('ignora eventos no-access (batería, calibración...)', async () => {
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({
      result: [
        { id: 20, event: 1, date: '2026-08-09T10:00:00Z' },
        { id: 21, event: 61, date: '2026-08-09T10:05:00Z', pinAlias: 'Elena' },
        { id: 22, event: 3, date: '2026-08-09T10:10:00Z' },
      ],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(1)
    expect(acc[0].id).toBe('td-21')
  })

  it('cruza propertyId desde tedee_lock_id de la BD', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({
      result: [{ id: 30, event: 61, date: '2026-08-09T11:00:00Z', pinAlias: 'Luis' }],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(1)
    expect(acc[0].propertyId).toBeTruthy()
    expect(acc[0].propertyId).not.toBe('')
  })

  it('sort descendente por fecha', async () => {
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({
      result: [
        { id: 40, event: 61, date: '2026-08-01T10:00:00Z' },
        { id: 41, event: 61, date: '2026-08-09T10:00:00Z' },
        { id: 42, event: 61, date: '2026-08-05T10:00:00Z' },
      ],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(3)
    expect(acc.map((a) => a.at.toISOString())).toEqual([
      '2026-08-09T10:00:00.000Z',
      '2026-08-05T10:00:00.000Z',
      '2026-08-01T10:00:00.000Z',
    ])
  })

  it('extrae actorName de accessLinkName', async () => {
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({
      result: [{ id: 50, event: 61, date: '2026-08-09T10:00:00Z', accessLinkName: 'Enlace compartido' }],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(1)
    expect(acc[0].actorName).toBe('Enlace compartido')
    expect(acc[0].actorRole).toBe('huésped')
  })

  it('error HTTP en locks propaga excepción', async () => {
    configurarTedeeCloud(db)
    mockResponse({ error: 'unauthorized' }, 401)
    await expect(tedeeAccesses(db)).rejects.toThrow('http-401')
  })

  it('consolida accesos de múltiples cerraduras', async () => {
    configurarTedeeCloud(db)
    mockResponse({
      result: [
        cloudLock,
        { id: 999, name: 'Garaje', isConnected: true, deviceState: { batteryLevel: 60 }, serialNumber: 'G-1' },
      ],
    })
    mockResponse({
      result: [{ id: 100, event: 61, date: '2026-08-09T08:00:00Z', pinAlias: 'X' }],
    })
    mockResponse({
      result: [{ id: 200, event: 65, date: '2026-08-09T09:00:00Z', pinAlias: 'Y' }],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(2)
    expect(acc[0].lockId).toBe('999') // más reciente: garaje 09:00
    expect(acc[0].type).toBe('salida')
    expect(acc[1].lockId).toBe('176718') // portal 08:00
    expect(acc[1].type).toBe('entrada')
  })
})

describe('tedeeLocks — propertyId', () => {
  it('asocia propertyId cuando tedee_lock_id coincide', async () => {
    const id = insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    const locks = await tedeeLocks(db)
    expect(locks).toHaveLength(1)
    expect(locks[0].propertyId).toBe(id)
  })

  it('propertyId vacío cuando el lock no está asociado', async () => {
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    const locks = await tedeeLocks(db)
    expect(locks).toHaveLength(1)
    expect(locks[0].propertyId).toBe('')
  })

  it('soporta múltiples locks con y sin asociación', async () => {
    const id = insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({
      result: [
        cloudLock,
        { id: 999, name: 'Sin asignar', isConnected: false, deviceState: { batteryLevel: 0 }, serialNumber: 'XX' },
      ],
    })
    const locks = await tedeeLocks(db)
    expect(locks).toHaveLength(2)
    expect(locks[0].propertyId).toBe(id)
    expect(locks[1].propertyId).toBe('')
  })
})
