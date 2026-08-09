// push.test.js — motor Web Push (notifyUsers, preferencias, quiet hours,
// borrado 404/410, demo) y motor de alertas de Keynest (checkin/checkout,
// reservas nuevas con anti-spam, Tedee offline/batería, limpiezas pendientes).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import webpush from 'web-push'
import { openDb } from '../src/db.js'
import { configurePush, notifyUsers, flushNotificationQueue, _setSendFn, _resetForTests } from '../src/push.js'
import {
  checkReservasHoy,
  notifyReservasNuevas,
  createTedeeChecker,
  checkLimpiezas,
  checkTransacciones,
  hoyLocal,
} from '../src/alerts.js'

// ical mockeado a nivel de módulo: controlamos las reservas que "vienen" del
// ICS en el test de syncAll sin red ni parsing real.
vi.mock('../src/ical.js', () => ({
  fetchIcs: vi.fn(async () => 'ICS'),
  parseIcs: vi.fn(() => []),
  icsToReservations: vi.fn(() => []),
}))

// Par VAPID real (setVapidDetails valida formato; claves fake no pasan).
const KEYS = webpush.generateVAPIDKeys()
function configura() {
  process.env.VAPID_PUBLIC_KEY = KEYS.publicKey
  configurePush({ publicKey: KEYS.publicKey, privateKey: KEYS.privateKey, subject: 'mailto:test@example.com' })
}

let dir
let db
beforeEach(() => {
  _resetForTests()
  dir = mkdtempSync(join(tmpdir(), 'keynest-push-test-'))
  db = openDb(dir, 'test.db')
})
afterEach(() => {
  _resetForTests()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function insertUser(username, language = 'es') {
  const id = crypto.randomUUID()
  db.prepare("INSERT INTO users (id, username, password_hash, language, role, created_at) VALUES (?, ?, 'x', ?, 'user', ?)").run(
    id,
    username,
    language,
    Date.now()
  )
  return id
}

function insertSub(userId, endpoint = `https://push.example.com/${crypto.randomUUID()}`) {
  const now = Date.now()
  db.prepare(
    'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, endpoint, 'p', 'a', now, now)
  return endpoint
}

function insertProperty(name = 'Carmen') {
  const id = crypto.randomUUID()
  db.prepare(
    "INSERT INTO properties (id, slug, name, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, name.toLowerCase() + '-' + id.slice(0, 6), name, Date.now())
  return id
}

function insertReservation(propertyId, { uid = crypto.randomUUID(), checkin, checkout, summary = 'Airbnb (AB12)' }) {
  db.prepare(
    'INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), propertyId, uid, checkin, checkout, summary, Date.now())
}

function captura() {
  const llamadas = []
  return { llamadas, notifyFn: (db, tipo, datos, opciones) => llamadas.push({ tipo, datos, opciones }) }
}

describe('schema', () => {
  it('crea las tablas push sin tocar las existentes', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    for (const t of ['push_subscriptions', 'notification_preferences', 'notification_quiet_hours', 'notification_queue']) {
      expect(tables).toContain(t)
    }
    expect(tables).toContain('reservations')
    expect(tables).toContain('cleanings')
  })
})

describe('motor notifyUsers', () => {
  it('envía con el idioma del usuario y borra suscripciones muertas (410)', async () => {
    const u1 = insertUser('ana', 'es')
    const u2 = insertUser('bob', 'en')
    insertSub(u1, 'https://push.example.com/ana')
    insertSub(u2, 'https://push.example.com/bob')
    const enviados = []
    _setSendFn(async (sub, payload) => {
      if (sub.endpoint.includes('bob')) {
        const err = new Error('Gone')
        err.statusCode = 410
        throw err
      }
      enviados.push({ sub, payload: JSON.parse(payload) })
    })
    configura()
    const res = await notifyUsers(db, [u1, u2], 'tedee_offline', { nombre: 'Portal' }, { severity: 'critical' })
    expect(res.enviados).toBe(1)
    expect(res.borrados).toBe(1)
    expect(enviados[0].payload.title).toBe('Cerradura offline')
    expect(enviados[0].payload.body).toContain('Portal')
    expect(db.prepare('SELECT * FROM push_subscriptions').all()).toHaveLength(1)
  })

  it('respeta preferencias: tipo desactivado = omitido', async () => {
    const u1 = insertUser('ana')
    insertSub(u1)
    db.prepare(
      'INSERT INTO notification_preferences (user_id, tipo, enabled, min_severity, updated_at) VALUES (?, ?, 0, ?, ?)'
    ).run(u1, 'checkin_hoy', 'normal', Date.now())
    configura()
    _setSendFn(async () => {
      throw new Error('no debería enviarse')
    })
    const res = await notifyUsers(db, [u1], 'checkin_hoy', { propiedad: 'X', resumen: 'Y' })
    expect(res.omitidos).toBe(1)
    expect(res.enviados).toBe(0)
  })

  it('quiet hours: pospone no-críticas y el flush consolida al salir', async () => {
    const u1 = insertUser('ana')
    insertSub(u1)
    const hora = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }).format(new Date())
    )
    db.prepare(
      'INSERT INTO notification_quiet_hours (user_id, quiet_start, quiet_end, tz, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(u1, hora, (hora + 2) % 24, 'Europe/Madrid', Date.now())
    configura()

    const res = await notifyUsers(db, [u1], 'limpieza_pendiente', { propiedad: 'X', fecha: '2026-08-01' }, { severity: 'high' })
    expect(res.pospuestos).toBe(1)
    // Las críticas (tedee_offline) NO se posponen
    const crit = await notifyUsers(db, [u1], 'tedee_offline', { nombre: 'P' }, { severity: 'critical' })
    expect(crit.pospuestos).toBe(0)

    await flushNotificationQueue(db)
    expect(db.prepare('SELECT * FROM notification_queue').all()).toHaveLength(1) // sigue en ventana
    db.prepare('DELETE FROM notification_quiet_hours').run()
    const enviados = []
    _setSendFn(async (sub, payload) => {
      enviados.push(JSON.parse(payload))
    })
    await flushNotificationQueue(db)
    expect(db.prepare('SELECT * FROM notification_queue').all()).toHaveLength(0)
    expect(enviados).toHaveLength(1)
    expect(enviados[0].title).toBe('Actividad en Keynest')
  })

  it('en demo no envía aunque haya suscripción', async () => {
    const u1 = insertUser('ana')
    insertSub(u1)
    configura()
    _setSendFn(async () => {
      throw new Error('no debería enviarse en demo')
    })
    const res = await notifyUsers(db, [u1], 'checkin_hoy', { propiedad: 'X', resumen: 'Y' }, { demo: true })
    expect(res.enviados).toBe(0)
    expect(res.omitidos).toBe(1)
  })

  it('sin VAPID configurado omite el envío real', async () => {
    const u1 = insertUser('ana')
    insertSub(u1)
    const res = await notifyUsers(db, [u1], 'tedee_offline', { nombre: 'P' }, { severity: 'critical' })
    expect(res.enviados).toBe(0)
    expect(res.omitidos).toBe(1)
  })
})

describe('alertas: check-in / check-out', () => {
  it('avisa de las entradas y salidas de hoy con inmueble y resumen', () => {
    const hoy = hoyLocal()
    const p = insertProperty('Ruzafa')
    insertReservation(p, { checkin: hoy, checkout: '2099-01-10', summary: 'Airbnb (HMK3)' })
    insertReservation(p, { checkin: '2026-07-28', checkout: hoy, summary: 'Booking (9912)' })
    insertReservation(p, { checkin: '2099-01-01', checkout: '2099-01-05', summary: 'Futura' })
    const { llamadas, notifyFn } = captura()
    const n = checkReservasHoy(db, notifyFn)
    expect(n).toBe(2)
    const tipos = llamadas.map((l) => l.tipo)
    expect(tipos).toContain('checkin_hoy')
    expect(tipos).toContain('checkout_hoy')
    expect(llamadas.find((l) => l.tipo === 'checkin_hoy').datos).toEqual({ propiedad: 'Ruzafa', resumen: 'Airbnb (HMK3)' })
    expect(llamadas.find((l) => l.tipo === 'checkout_hoy').datos.resumen).toBe('Booking (9912)')
    expect(llamadas.every((l) => l.opciones.url.startsWith('/reservas?reserva='))).toBe(true)
  })
})

describe('alertas: reservas nuevas', () => {
  it('hasta 3 avisa individualmente; más de 3 agrupa en UN aviso', () => {
    const { llamadas, notifyFn } = captura()
    notifyReservasNuevas(db, 'Carmen', [
      { summary: 'A', checkin: '2026-08-10', checkout: '2026-08-12' },
      { summary: 'B', checkin: '2026-08-15', checkout: '2026-08-18' },
    ], notifyFn)
    expect(llamadas).toHaveLength(2)
    expect(llamadas[0].tipo).toBe('reserva_nueva')
    expect(llamadas[0].datos.tiempo).toBe('2026-08-10 → 2026-08-12')

    llamadas.length = 0
    notifyReservasNuevas(db, 'Carmen', Array.from({ length: 6 }, (_, i) => ({ summary: `R${i}`, checkin: '2026-09-01', checkout: '2026-09-03' })), notifyFn)
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].tipo).toBe('reservas_nuevas')
    expect(llamadas[0].datos.total).toBe(6)
  })

  it('sin items no avisa', () => {
    const { llamadas, notifyFn } = captura()
    notifyReservasNuevas(db, 'Carmen', [], notifyFn)
    expect(llamadas).toHaveLength(0)
  })

  it('enriquece con tiempo + personas + importe cuando la reserva tiene CSV', () => {
    // La reserva ya está en BD con amount/guest_name (importada del CSV antes
    // o por un sync posterior); el item del iCal solo trae fechas/summary.
    const p = insertProperty('Ruzafa')
    const code = 'HMK3XYZ'
    db.prepare(
      `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, amount, guest_name, created_at)
       VALUES (?, ?, ?, '2026-08-10', '2026-08-12', 'A', ?, 450, 'María', ?)`
    ).run(crypto.randomUUID(), p, 'ical-uid-1', code, Date.now())
    const { llamadas, notifyFn } = captura()
    notifyReservasNuevas(db, 'Ruzafa', [{ summary: 'A', checkin: '2026-08-10', checkout: '2026-08-12', confirmation_code: code }], notifyFn)
    expect(llamadas[0].datos).toMatchObject({
      tiempo: '2026-08-10 → 2026-08-12',
      importe: 450,
      huesped: 'María',
    })
  })

  it('sin importe/personas en BD no inventa campos', () => {
    const p = insertProperty('Ruzafa')
    const code = 'HMK3NO'
    db.prepare(
      `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, amount, created_at)
       VALUES (?, ?, ?, '2026-08-10', '2026-08-12', 'A', ?, 0, ?)`
    ).run(crypto.randomUUID(), p, 'ical-uid-2', code, Date.now())
    const { llamadas, notifyFn } = captura()
    notifyReservasNuevas(db, 'Ruzafa', [{ summary: 'A', checkin: '2026-08-10', checkout: '2026-08-12', confirmation_code: code }], notifyFn)
    expect(llamadas[0].datos).toEqual({
      propiedad: 'Ruzafa',
      resumen: 'A',
      tiempo: '2026-08-10 → 2026-08-12',
    })
  })
})

describe('alertas: transacción abonada (24h post check-in)', () => {
  function ayerLocal() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(Date.now() - 24 * 3600 * 1000)
  }

  it('avisa de reservas cuyo check-in fue ayer con importe, y no se repite', () => {
    const p = insertProperty('Ruzafa')
    const ayer = ayerLocal()
    const mañana = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(Date.now() + 24 * 3600 * 1000)
    const id = crypto.randomUUID()
    db.prepare(
      `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, amount, guest_name, created_at)
       VALUES (?, ?, ?, ?, ?, 'A', 'TX1', 450, 'María', ?)`
    ).run(id, p, 'tx-uid-1', ayer, mañana, Date.now())
    const { llamadas, notifyFn } = captura()
    const n1 = checkTransacciones(db, notifyFn)
    expect(n1).toBe(1)
    expect(llamadas[0].tipo).toBe('transaccion')
    expect(llamadas[0].datos).toMatchObject({ propiedad: 'Ruzafa', importe: 450, huesped: 'María' })
    expect(llamadas[0].opciones.url).toBe(`/reservas?reserva=${id}`)

    llamadas.length = 0
    const n2 = checkTransacciones(db, notifyFn)
    expect(n2).toBe(0) // dedupe: no se vuelve a avisar
    expect(llamadas).toHaveLength(0)
  })

  it('no avisa sin importe (amount=0) ni de otras fechas', () => {
    const p = insertProperty('Ruzafa')
    const ayer = ayerLocal()
    const hoy = hoyLocal()
    db.prepare(
      `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, amount, created_at)
       VALUES (?, ?, ?, ?, ?, 'SinImporte', 0, ?)`
    ).run(crypto.randomUUID(), p, 'tx-uid-2', ayer, ayer, Date.now())
    db.prepare(
      `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, amount, created_at)
       VALUES (?, ?, ?, ?, ?, 'DeHoy', 900, ?)`
    ).run(crypto.randomUUID(), p, 'tx-uid-3', hoy, hoy, Date.now())
    const { llamadas, notifyFn } = captura()
    const n = checkTransacciones(db, notifyFn)
    expect(n).toBe(0)
    expect(llamadas).toHaveLength(0)
  })
})

describe('alertas: Tedee', () => {
  const lockOn = { id: 1, name: 'Portal', battery: 85, online: true }
  const lockOff = { ...lockOn, online: false }

  it('offline a los 3 ticks (crítica), sin reenvíos, y avisa al recuperar', async () => {
    const { llamadas, notifyFn } = captura()
    let locks = [lockOff]
    const checker = createTedeeChecker({ db, notifyFn, locksFn: async () => locks })
    await checker.check()
    await checker.check()
    expect(llamadas).toHaveLength(0) // anti-rebote
    await checker.check()
    expect(llamadas.map((l) => l.tipo)).toEqual(['tedee_offline'])
    expect(llamadas[0].opciones.severity).toBe('critical')
    await checker.check()
    expect(llamadas).toHaveLength(1) // no reenvía
    locks = [lockOn]
    await checker.check()
    expect(llamadas.map((l) => l.tipo)).toEqual(['tedee_offline', 'tedee_ok'])
  })

  it('batería ≤20% avisa una vez y se rearma >30%', async () => {
    const { llamadas, notifyFn } = captura()
    let locks = [{ ...lockOn, battery: 15 }]
    const checker = createTedeeChecker({ db, notifyFn, locksFn: async () => locks })
    await checker.check()
    expect(llamadas.map((l) => l.tipo)).toEqual(['tedee_bateria'])
    expect(llamadas[0].datos).toEqual({ nombre: 'Portal', nivel: 15 })
    expect(llamadas[0].opciones.severity).toBe('high')
    await checker.check()
    expect(llamadas).toHaveLength(1)
    locks = [{ ...lockOn, battery: 50 }]
    await checker.check()
    locks = [{ ...lockOn, battery: 18 }]
    await checker.check()
    expect(llamadas).toHaveLength(2) // rearmado: vuelve a avisar
  })

  it('error del bridge cuenta tick offline SOLO para cerraduras ya vistas', async () => {
    const { llamadas, notifyFn } = captura()
    let modo = 'error'
    const checker = createTedeeChecker({
      db,
      notifyFn,
      locksFn: async () => {
        if (modo === 'error') throw new Error('http-500')
        return [lockOn]
      },
    })
    // Sin fetch bueno previo: errores seguidos NO alertan (arranque sin datos)
    await checker.check()
    await checker.check()
    await checker.check()
    await checker.check()
    expect(llamadas).toHaveLength(0)
    // Tras ver la cerradura, 3 errores seguidos = offline
    modo = 'ok'
    await checker.check()
    modo = 'error'
    await checker.check()
    await checker.check()
    expect(llamadas).toHaveLength(0)
    await checker.check()
    expect(llamadas.map((l) => l.tipo)).toEqual(['tedee_offline'])
  })

  it('sin configurar Tedee no hace nada', async () => {
    const { llamadas, notifyFn } = captura()
    const checker = createTedeeChecker({
      db,
      notifyFn,
      locksFn: async () => {
        throw new Error('not-configured')
      },
    })
    await checker.check()
    expect(llamadas).toHaveLength(0)
  })
})

describe('alertas: limpiezas pendientes', () => {
  it('avisa de las pendientes con fecha ≤ hoy, UNA vez por día', () => {
    const p = insertProperty('Marina')
    const hoy = hoyLocal()
    db.prepare(
      "INSERT INTO cleanings (id, property_id, date, status, created_at) VALUES (?, ?, ?, 'pendiente', ?)"
    ).run('c1', p, '2026-07-30', Date.now())
    db.prepare(
      "INSERT INTO cleanings (id, property_id, date, status, created_at) VALUES (?, ?, ?, 'pendiente', ?)"
    ).run('c2', p, hoy, Date.now())
    db.prepare(
      "INSERT INTO cleanings (id, property_id, date, status, created_at) VALUES (?, ?, ?, 'completada', ?)"
    ).run('c3', p, '2026-07-29', Date.now())
    db.prepare(
      "INSERT INTO cleanings (id, property_id, date, status, created_at) VALUES (?, ?, ?, 'pendiente', ?)"
    ).run('c4', p, '2099-01-01', Date.now())
    const { llamadas, notifyFn } = captura()
    const n = checkLimpiezas(db, notifyFn)
    expect(n).toBe(2) // c1 (pasada) y c2 (hoy); c3 completada y c4 futura no
    expect(llamadas.every((l) => l.tipo === 'limpieza_pendiente' && l.opciones.severity === 'high')).toBe(true)
    expect(llamadas.map((l) => l.datos.propiedad)).toEqual(['Marina', 'Marina'])
    // Segunda pasada el mismo día: dedupe por kv, 0 avisos nuevos
    llamadas.length = 0
    const n2 = checkLimpiezas(db, notifyFn)
    expect(n2).toBe(0)
    expect(llamadas).toHaveLength(0)
  })
})

describe('sync iCal → reservas nuevas', () => {
  it('detecta uids nuevos tras sync OK previo; NUNCA en el primer sync', async () => {
    const { syncAll } = await import('../src/sync.js')
    const ical = await import('../src/ical.js')

    const p = insertProperty('Benimaclet')
    db.prepare("UPDATE properties SET ical_url = 'https://x' WHERE id = ?").run(p)

    const news = []
    const onNews = (prop, its) => news.push(...its.map((i) => ({ prop, ...i })))

    // Primer sync (sin OK previo): NO avisa aunque todo sea "nuevo"
    ical.icsToReservations.mockReturnValue([
      { uid: 'a@airbnb.com', checkin: '2026-08-10', checkout: '2026-08-12', summary: 'A', confirmation_code: '', phone_last4: '' },
    ])
    await syncAll(db, { onNews })
    expect(news).toHaveLength(0)

    // Segundo sync con una reserva NUEVA: avisa solo de la nueva
    ical.icsToReservations.mockReturnValue([
      { uid: 'a@airbnb.com', checkin: '2026-08-10', checkout: '2026-08-12', summary: 'A', confirmation_code: '', phone_last4: '' },
      { uid: 'b@airbnb.com', checkin: '2026-09-01', checkout: '2026-09-03', summary: 'B', confirmation_code: '', phone_last4: '' },
    ])
    await syncAll(db, { onNews })
    expect(news).toHaveLength(1)
    expect(news[0].uid).toBe('b@airbnb.com')
    expect(news[0].prop).toBe('Benimaclet')

    // Tercer sync sin cambios: no avisa
    await syncAll(db, { onNews })
    expect(news).toHaveLength(1)
  })
})
