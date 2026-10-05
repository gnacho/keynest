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

function insertarPropiedad(lockId, slug = 'prop') {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO properties (id, slug, name, address, bedrooms, bathrooms, area, photo, checklist, instructions, created_at, tedee_lock_id)
     VALUES (?, ?, 'Mi Propiedad', 'Calle 1', 1, 1, 50, '', '[]', '', ?, ?)`,
  ).run(id, slug, new Date().toISOString(), lockId)
  return id
}

function insertarReserva(propertyId, checkin, checkout, guestName) {
  db.prepare(
    `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, phone_last4, guest_name, created_at)
     VALUES (?, ?, ?, ?, ?, 'Reserved', 'CODE', '', ?, ?)`,
  ).run(crypto.randomUUID(), propertyId, `uid-${crypto.randomUUID()}`, checkin, checkout, guestName, Date.now())
}

function insertarPersona(name, role = 'limpieza') {
  db.prepare(
    `INSERT INTO people (id, name, phone, role, specialty, hourly_rate, created_at)
     VALUES (?, ?, '', ?, '', 10, 0)`,
  ).run(crypto.randomUUID(), name, role)
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
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279) // locks
    mockResponse({ result: [] }) // deviceactivity vacío
    const acc = await tedeeAccesses(db)
    expect(acc).toEqual([])
  })

  it('mapea PIN unlock → entrada, keypad lock → salida, orden descendente', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
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
    expect(acc[0].actorRole).toBe('propietario') // solo username (app) → no huésped (#281)
    expect(acc[0].lockId).toBe('176718')
    expect(acc[0].id).toBe('td-2')
    expect(acc[1].type).toBe('entrada')
    expect(acc[1].actorRole).toBe('huésped') // PIN sin match en personas → huésped
    expect(acc[1].id).toBe('td-1')
  })

  it('eventos de app → remota, sin actor → propietario', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    mockResponse({
      result: [{ id: 3, event: 32, date: '2026-08-09T14:00:00Z' }],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(1)
    expect(acc[0].type).toBe('remota')
    expect(acc[0].actorRole).toBe('propietario')
    expect(acc[0].actorName).toBe('')
  })

  it('#281 PIN de persona de limpieza → actorRole limpieza, en entrada y en salida', async () => {
    insertarPropiedad(176718)
    insertarPersona('Flor')
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    mockResponse({
      result: [
        { id: 20, event: 61, date: '2026-08-09T10:00:00Z', pinAlias: 'Flor' },
        { id: 21, event: 65, date: '2026-08-09T12:00:00Z', pinAlias: 'Flor' },
      ],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(2)
    expect(acc[0].type).toBe('salida')
    expect(acc[0].actorRole).toBe('limpieza')
    expect(acc[0].actorName).toBe('Flor')
    expect(acc[1].type).toBe('entrada')
    expect(acc[1].actorRole).toBe('limpieza')
  })

  it('#281 persona conocida NO se etiqueta como huésped aunque haya estancia', async () => {
    const pid = insertarPropiedad(176718)
    insertarReserva(pid, '2026-08-01', '2026-08-31', 'Rainer Zbinden')
    insertarPersona('Flor')
    insertarPersona('Manolo Fontanero', 'proveedor')
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    mockResponse({
      result: [
        { id: 22, event: 61, date: '2026-08-09T10:00:00Z', pinAlias: 'Flor' },
        { id: 23, event: 61, date: '2026-08-09T11:00:00Z', pinAlias: 'Manolo Fontanero' },
        { id: 24, event: 61, date: '2026-08-09T12:00:00Z', pinAlias: 'Desconocido' },
      ],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(3)
    expect(acc[2].actorRole).toBe('limpieza')
    expect(acc[2].guestName).toBe('Rainer Zbinden') // el cruce sigue llegando al front
    expect(acc[1].actorRole).toBe('propietario') // proveedor: actor real, no huésped
    expect(acc[0].actorRole).toBe('huésped') // alias ajeno a personas → huésped
  })

  it('#281 cierre con botón del lock (34) o manual (38) → salida; force unlock por PIN (68) → entrada', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    mockResponse({
      result: [
        { id: 30, event: 34, date: '2026-08-09T10:00:00Z', username: 'Nacho' },
        { id: 31, event: 38, date: '2026-08-09T11:00:00Z', username: 'Nacho' },
        { id: 32, event: 68, date: '2026-08-09T12:00:00Z', pinAlias: 'Nacho' },
      ],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(3)
    expect(acc[2].type).toBe('salida')
    expect(acc[2].actorRole).toBe('propietario')
    expect(acc[1].type).toBe('salida')
    expect(acc[0].type).toBe('entrada')
  })

  it('#281 usuario de la app (userName, sin PIN) → nombre real y rol por personas', async () => {
    insertarPropiedad(176718)
    insertarPersona('Flor')
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    mockResponse({
      result: [
        { id: 26, event: 33, date: '2026-08-09T10:00:00Z', userName: 'Flor' },
        { id: 27, event: 33, date: '2026-08-09T11:00:00Z', userName: 'Nacho' },
      ],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(2)
    // La API devuelve userName (docs oficiales); Flor está en people → limpieza
    expect(acc[1].actorName).toBe('Flor')
    expect(acc[1].actorRole).toBe('limpieza')
    // usuario de app sin match en people → propietario, con su nombre
    expect(acc[0].actorName).toBe('Nacho')
    expect(acc[0].actorRole).toBe('propietario')
  })

  it('huella → entrada', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
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
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
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
    mockResponse({ result: { keypads: [] } }) // details (#279)
    mockResponse({
      result: [{ id: 30, event: 61, date: '2026-08-09T11:00:00Z', pinAlias: 'Luis' }],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(1)
    expect(acc[0].propertyId).toBeTruthy()
    expect(acc[0].propertyId).not.toBe('')
  })

  it('sort descendente por fecha', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
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
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
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
    insertarPropiedad(176718, 'portal')
    insertarPropiedad(999, 'garaje')
    configurarTedeeCloud(db)
    mockResponse({
      result: [
        cloudLock,
        { id: 999, name: 'Garaje', isConnected: true, deviceState: { batteryLevel: 60 }, serialNumber: 'G-1' },
      ],
    })
    mockResponse({ result: { keypads: [] } }) // details (#279)
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

describe('solo cerraduras asignadas (#277)', () => {
  it('tedeeLocks(soloAsignadas) filtra las cerraduras sin inmueble', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({
      result: [
        cloudLock,
        { id: 999, name: 'Sin asignar', isConnected: false, deviceState: { batteryLevel: 0 }, serialNumber: 'XX' },
      ],
    })
    const locks = await tedeeLocks(db, { soloAsignadas: true })
    expect(locks).toHaveLength(1)
    expect(locks[0].id).toBe(176718)
  })

  it('tedeeAccesses ignora los accesos de cerraduras sin inmueble', async () => {
    configurarTedeeCloud(db)
    mockResponse({
      result: [
        { id: 999, name: 'Sin asignar', isConnected: true, deviceState: { batteryLevel: 60 }, serialNumber: 'XX' },
      ],
    })
    mockResponse({
      result: [{ id: 300, event: 61, date: '2026-08-09T08:00:00Z', pinAlias: 'X' }],
    })
    const acc = await tedeeAccesses(db)
    expect(acc).toEqual([])
  })
})

describe('inquilino del acceso (#277)', () => {
  // Fechas locales (sin Z): fechaLocal() no depende del TZ del entorno.
  const dia = '2026-08-09T12:00:00'

  it('reserva activa → guestName con el nombre del huésped', async () => {
    const prop = insertarPropiedad(176718)
    insertarReserva(prop, '2026-08-05', '2026-08-14', 'Laith Kawar')
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    mockResponse({ result: [{ id: 400, event: 61, date: dia }] }) // sin actor
    const acc = await tedeeAccesses(db)
    expect(acc).toHaveLength(1)
    expect(acc[0].guestName).toBe('Laith Kawar')
    expect(acc[0].actorRole).toBe('huésped')
  })

  it('sin reserva que cubra la fecha → guestName vacío', async () => {
    const prop = insertarPropiedad(176718)
    insertarReserva(prop, '2026-08-20', '2026-08-25', 'Otro huésped')
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    mockResponse({ result: [{ id: 401, event: 61, date: dia, pinAlias: 'Ana' }] })
    const acc = await tedeeAccesses(db)
    expect(acc[0].guestName).toBe('')
    expect(acc[0].actorRole).toBe('huésped') // por el alias del PIN
  })

  it('el día del checkout sigue siendo del huésped saliente', async () => {
    const prop = insertarPropiedad(176718)
    insertarReserva(prop, '2026-08-05', '2026-08-09', 'Saliente')
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    // 10:00Z → mismo día local; lock por keypad = salida ese mismo día
    mockResponse({ result: [{ id: 402, event: 65, date: '2026-08-09T08:00:00' }] })
    const acc = await tedeeAccesses(db)
    expect(acc[0].guestName).toBe('Saliente')
  })

  it('empate checkout+checkin el mismo día → gana el ya alojado', async () => {
    const prop = insertarPropiedad(176718)
    insertarReserva(prop, '2026-08-01', '2026-08-09', 'Saliente')
    insertarReserva(prop, '2026-08-09', '2026-08-14', 'Entrante')
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    mockResponse({ result: [{ id: 403, event: 61, date: dia }] })
    const acc = await tedeeAccesses(db)
    expect(acc[0].guestName).toBe('Saliente')
  })

  it('reservas de otros inmuebles no contaminan el acceso', async () => {
    insertarPropiedad(176718)
    const otra = insertarPropiedad(1, 'otra')
    insertarReserva(otra, '2026-08-01', '2026-08-30', 'De otro inmueble')
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    mockResponse({ result: [{ id: 404, event: 61, date: dia }] })
    const acc = await tedeeAccesses(db)
    expect(acc[0].guestName).toBe('')
    expect(acc[0].actorRole).toBe('propietario')
  })
})

describe('tedeeLocks — propertyId', () => {
  it('asocia propertyId cuando tedee_lock_id coincide', async () => {
    const id = insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
    const locks = await tedeeLocks(db)
    expect(locks).toHaveLength(1)
    expect(locks[0].propertyId).toBe(id)
  })

  it('propertyId vacío cuando el lock no está asociado', async () => {
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ result: { keypads: [] } }) // details (#279)
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

describe('teclados emparejados (#279)', () => {
  it('la cerradura recibe la batería de su teclado (connectedToLockId)', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({
      result: {
        keypads: [{ id: 9001, type: 3, name: 'ag47-pad', connectedToLockId: 176718, deviceState: { batteryLevel: 8, batteryLevelModifiedTime: '2026-10-04T17:55:33Z' } }],
      },
    })
    const locks = await tedeeLocks(db)
    expect(locks[0].keypad).toEqual({ name: 'ag47-pad', battery: 8, modified: '2026-10-04T17:55:33Z' })
  })

  it('keypad sin deviceState (sin batería) → keypad null', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({
      result: { keypads: [{ id: 9002, type: 10, name: 'sin-bateria', connectedToLockId: 176718 }] },
    })
    const locks = await tedeeLocks(db)
    expect(locks[0].keypad).toBeNull()
  })

  it('keypad de otra cerradura no se mezcla', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({
      result: { keypads: [{ id: 9003, type: 3, name: 'otro', connectedToLockId: 999, deviceState: { batteryLevel: 50 } }] },
    })
    const locks = await tedeeLocks(db)
    expect(locks[0].keypad).toBeNull()
  })

  it('bridge local: keypad null (no expone keypads)', async () => {
    insertarPropiedad(176718)
    configurarTedeeBridge(db)
    mockResponse([{ id: 176718, name: 'Portal', batteryLevel: 70, isConnected: true, state: 2, serialNumber: 'SN-B' }])
    const locks = await tedeeLocks(db)
    expect(locks[0].keypad).toBeNull()
  })

  it('details caído: cerraduras cargan igual con keypad null', async () => {
    insertarPropiedad(176718)
    configurarTedeeCloud(db)
    mockResponse({ result: [cloudLock] })
    mockResponse({ error: 'oops' }, 500)
    const locks = await tedeeLocks(db)
    expect(locks).toHaveLength(1)
    expect(locks[0].keypad).toBeNull()
  })
})
