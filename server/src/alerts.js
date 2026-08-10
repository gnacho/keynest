// alerts.js — motor de alertas push de Keynest (alertas operativas del negocio).
//
// Triggers (decisión del usuario 2-Ago-2026):
// - checkin_hoy / checkout_hoy: job diario (09:00 local) con las entradas y
//   salidas del día por inmueble. Severidad normal.
// - reserva_nueva: el sync iCal detecta uids NUEVOS (no estaban en BD antes
//   del upsert). Anti-spam: >3 de golpe = UN aviso agrupado (imports masivos).
//   NUNCA en el primer sync OK de un inmueble (import inicial = todo "nuevo").
// - tedee_offline / tedee_ok: cerradura sin responder en 3 chequeos seguidos
//   (intervalo 5 min → 15 min de gracia por caídas BLE puntuales). Crítica
//   (un huésped no puede entrar). Si el bridge/API entero falla, cuenta como
//   tick offline SOLO para cerraduras ya vistas (nunca falsos positivos en
//   arranque sin config).
// - tedee_bateria: nivel ≤ 20% (high), se rearma > 30%.
// - limpieza_pendiente: job diario (12:00 local): limpiezas 'pendiente' con
//   fecha ≤ hoy (el check-out ya pasó o es hoy). Dedupe por kv: un aviso por
//   limpieza y día como máximo.
// - transaccion: job diario: reservas cuyo check-in fue AYER (24h después,
//   cuando Airbnb suele abonar) con importe registrado (amount > 0, del CSV).
//   Informa importe + inmueble + huésped. Dedupe por kv: un aviso por reserva.
//
// notifyFn inyectable para tests (defecto: notifyAll de push.js).
import { kvGet, kvSet } from './db.js'
import { tedeeLocks } from './tedee.js'
import { notifyAll } from './push.js'

const TICKS_TEDEE_OFFLINE = 3
const TEDEE_BAT_BAJA = 20
const TEDEE_BAT_REARME = 30
const MAX_AVISOS_INDIVIDUALES = 3

// Fecha local YYYY-MM-DD en la zona del negocio (alquileres en España).
export function hoyLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// ── Check-in / check-out del día ─────────────────────────────────────────────
export function checkReservasHoy(db, notifyFn = notifyAll) {
  const hoy = hoyLocal()
  const filas = db
    .prepare(
      `SELECT r.id, r.checkin, r.checkout, r.summary, p.name AS propiedad
       FROM reservations r JOIN properties p ON p.id = r.property_id
       WHERE r.checkin = ? OR r.checkout = ?`
    )
    .all(hoy, hoy)
  for (const r of filas) {
    if (r.checkin === hoy) {
      notifyFn(db, 'checkin_hoy', { propiedad: r.propiedad, resumen: r.summary }, { severity: 'normal', url: `/reservas?reserva=${r.id}` })
    }
    if (r.checkout === hoy) {
      notifyFn(db, 'checkout_hoy', { propiedad: r.propiedad, resumen: r.summary }, { severity: 'normal', url: `/reservas?reserva=${r.id}` })
    }
  }
  return filas.length
}

// ── Reservas nuevas importadas (llamado desde el sync iCal) ──────────────────
// Enriquecido (issue #34): además de inmueble + resumen, se informa del tiempo
// (checkin → checkout), personas y importe CUANDO existan (vienen del CSV de
// Airbnb, no del iCal; el iCal solo trae fechas/summary).
const guestsDisponible = new WeakMap()
function tieneGuests(db) {
  if (!guestsDisponible.has(db)) {
    const cols = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name)
    guestsDisponible.set(db, cols.includes('guests'))
  }
  return guestsDisponible.get(db)
}

function detalleReserva(db, item) {
  const d = { tiempo: `${item.checkin} → ${item.checkout}` }
  // El CSV cruza por confirmation_code; si no hay, se busca por uid.
  const fila = item.confirmation_code
    ? db.prepare('SELECT amount, guest_name FROM reservations WHERE confirmation_code = ?').get(item.confirmation_code)
    : null
  const r = fila || (item.uid ? db.prepare('SELECT amount, guest_name FROM reservations WHERE uid = ?').get(item.uid) : null)
  if (!r) return d
  if (tieneGuests(db)) {
    const g = (item.confirmation_code
      ? db.prepare('SELECT guests FROM reservations WHERE confirmation_code = ?').get(item.confirmation_code)
      : item.uid ? db.prepare('SELECT guests FROM reservations WHERE uid = ?').get(item.uid) : null)
    if (g?.guests) d.personas = g.guests
  }
  if (r.amount > 0) d.importe = r.amount
  if (r.guest_name) d.huesped = r.guest_name
  return d
}

export function notifyReservasNuevas(db, propiedad, items, notifyFn = notifyAll) {
  if (!items || items.length === 0) return
  if (items.length > MAX_AVISOS_INDIVIDUALES) {
    // Import grande (p. ej. alta de inmueble o temporada): UN aviso agrupado.
    notifyFn(db, 'reservas_nuevas', { total: items.length }, { severity: 'normal', url: '/reservas' })
    return
  }
  for (const i of items) {
    // Deep-link: la reserva ya está en BD (el upsert ocurre antes de onNews);
    // se busca por uid o confirmation_code para llevar la reserva concreta.
    const fila = db
      .prepare('SELECT id FROM reservations WHERE uid = ? OR (confirmation_code IS NOT NULL AND confirmation_code = ?)')
      .get(i.uid ?? '', i.confirmation_code ?? '')
    const url = fila?.id ? `/reservas?reserva=${fila.id}` : '/reservas'
    notifyFn(
      db,
      'reserva_nueva',
      { propiedad, resumen: i.summary, ...detalleReserva(db, i) },
      { severity: 'normal', url }
    )
  }
}

// ── Transacción abonada: 24h después del check-in con importe ────────────────
// Airbnb suele abonar el pago ~24h tras el check-in; solo se avisa si la
// reserva tiene importe registrado (amount > 0, del CSV). Dedupe por kv:
// un aviso por reserva (nunca más, aunque el job se repita).
export function checkTransacciones(db, notifyFn = notifyAll) {
  const ayer = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(Date.now() - 24 * 3600 * 1000)
  const filas = db
    .prepare(
      `SELECT r.id, r.checkin, r.checkout, r.summary, r.amount, r.guest_name, p.name AS propiedad
       FROM reservations r JOIN properties p ON p.id = r.property_id
       WHERE r.checkin = ? AND r.amount > 0`
    )
    .all(ayer)
  let avisos = 0
  for (const f of filas) {
    const key = `push_tx_${f.id}`
    if (kvGet(db, key)) continue // ya avisada
    notifyFn(
      db,
      'transaccion',
      { propiedad: f.propiedad, resumen: f.summary, importe: f.amount, huesped: f.guest_name || null },
      { severity: 'normal', url: `/reservas?reserva=${f.id}` }
    )
    kvSet(db, key, '1')
    avisos++
  }
  return avisos
}

// ── Tedee: offline (3 ticks) y batería baja ──────────────────────────────────
export function createTedeeChecker({ db, notifyFn = notifyAll, locksFn = tedeeLocks }) {
  // Por cerradura (id): ticks offline seguidos + flancos ya alertados.
  const estado = new Map()
  let vioCerraduras = false

  function estadoDe(id) {
    let e = estado.get(id)
    if (!e) {
      e = { nombre: String(id), mal: 0, alertadoOff: false, alertadoBat: false }
      estado.set(id, e)
    }
    return e
  }

  async function check() {
    let locks
    try {
      locks = await locksFn(db)
    } catch (err) {
      if (err?.message === 'not-configured') return // sin config Tedee: nada que vigilar
      // Bridge/API caído: las cerraduras conocidas cuentan tick offline (si
      // nunca hubo un fetch bueno, no hay nada que alertar: sin falsos +).
      if (!vioCerraduras) return
      for (const e of estado.values()) {
        e.mal++
        if (!e.alertadoOff && e.mal >= TICKS_TEDEE_OFFLINE) {
          e.alertadoOff = true
          notifyFn(db, 'tedee_offline', { nombre: e.nombre }, { severity: 'critical', url: `/tedee?lock=${e.id}` })
        }
      }
      return
    }
    if (locks.length > 0) vioCerraduras = true
    for (const l of locks) {
      const e = estadoDe(l.id)
      e.nombre = l.name || e.nombre
      if (!l.online) {
        e.mal++
        if (!e.alertadoOff && e.mal >= TICKS_TEDEE_OFFLINE) {
          e.alertadoOff = true
          notifyFn(db, 'tedee_offline', { nombre: e.nombre }, { severity: 'critical', url: `/tedee?lock=${e.id}` })
        }
      } else {
        if (e.alertadoOff) {
          e.alertadoOff = false
          notifyFn(db, 'tedee_ok', { nombre: e.nombre }, { severity: 'normal', url: `/tedee?lock=${e.id}` })
        }
        e.mal = 0
      }
      // Batería: solo con la cerradura online (offline ya avisa por su lado).
      if (l.online && l.battery > 0) {
        if (!e.alertadoBat && l.battery <= TEDEE_BAT_BAJA) {
          e.alertadoBat = true
          notifyFn(db, 'tedee_bateria', { nombre: e.nombre, nivel: l.battery }, { severity: 'high', url: `/tedee?lock=${e.id}` })
        } else if (e.alertadoBat && l.battery > TEDEE_BAT_REARME) {
          e.alertadoBat = false
        }
      }
    }
  }

  return { check, estado }
}

// ── Limpiezas pendientes (dedupe: 1 aviso por limpieza y día) ────────────────
export function checkLimpiezas(db, notifyFn = notifyAll) {
  const hoy = hoyLocal()
  const filas = db
    .prepare(
      `SELECT c.id, c.date, p.name AS propiedad
       FROM cleanings c JOIN properties p ON p.id = c.property_id
       WHERE c.status = 'pendiente' AND c.date <= ?`
    )
    .all(hoy)
  let avisos = 0
  for (const f of filas) {
    const key = `push_clean_${f.id}`
    if (kvGet(db, key) === hoy) continue // ya avisada hoy
    notifyFn(db, 'limpieza_pendiente', { propiedad: f.propiedad, fecha: f.date }, { severity: 'high', url: `/limpieza?tarea=${f.id}` })
    kvSet(db, key, hoy)
    avisos++
  }
  return avisos
}

// ── Recordatorios de mantenimiento (asignados a usuarios) ─────────────────
// Tareas con fecha prevista mañana u hoy, asignadas a un USUARIO de la app
// (no proveedor externo). Un aviso el día antes y otro el mismo día como
// recordatorio. Dedupe por kv por tarea+día.
export function checkMantenimientoRecordatorios(db, notifyUsersFn) {
  const hoy = hoyLocal()
  const manana = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(Date.now() + 24 * 3600 * 1000)

  const filas = db
    .prepare(
      `SELECT m.id, m.title, m.scheduled_date, m.assigned_user_id, p.name AS propiedad
       FROM maintenance_tasks m
       JOIN properties p ON p.id = m.property_id
       WHERE m.status != 'finalizada'
         AND m.assigned_user_id IS NOT NULL
         AND (m.scheduled_date = ? OR m.scheduled_date = ?)`
    )
    .all(hoy, manana)
  let avisos = 0
  for (const f of filas) {
    const cuando = f.scheduled_date === hoy ? 'hoy' : 'manana'
    const key = `push_maint_rem_${f.id}_${f.scheduled_date}`
    if (kvGet(db, key)) continue
    notifyUsersFn(db, [f.assigned_user_id], 'mantenimiento_recordatorio',
      { propiedad: f.propiedad, titulo: f.title, cuando },
      { severity: 'normal', url: '/mantenimiento' }
    )
    kvSet(db, key, '1')
    avisos++
  }
  return avisos
}

// ── Scheduler diario a hora fija local (patrón scheduleNightly de Helios) ────
export function scheduleDaily(hora, fn, nombre) {
  const now = new Date()
  const next = new Date(now)
  next.setHours(hora, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  setTimeout(async () => {
    try {
      await fn()
      console.log(`[keynest] job diario ${nombre} ejecutado`)
    } catch (err) {
      console.error(`[keynest] job diario ${nombre} error:`, err.message)
    }
    scheduleDaily(hora, fn, nombre)
  }, next.getTime() - now.getTime()).unref()
}
