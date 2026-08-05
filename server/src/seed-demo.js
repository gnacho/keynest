import crypto from 'node:crypto'

/**
 * Seed determinista de la BD demo (dataset de muestra, fechas relativas a hoy).
 * 5 inmuebles con checklist/instrucciones + reservas cubriendo ±1 mes,
 * personas de limpieza/proveedores, limpiezas generadas de los check-outs,
 * tareas de mantenimiento y gastos recurrentes. Solo se ejecuta si la BD demo
 * está vacía. Todos los datos son ficticios (modo demo).
 */

const PROPS = [
  { slug: 'atico-marina', name: 'Ático Marina', address: 'C/ del Mar 14, Valencia', bedrooms: 2, bathrooms: 1, area: 78, photo: '/prop-marina.svg', checklist: ['Baño', 'Cocina', 'Sábanas y toallas', 'Reposición', 'Revisar terraza', 'Fotos'], instructions: 'Entrar por el portal B (2ºB, llave en la caja del tendedero, código 1420). La terraza se limpia SIEMPRE. Productos bajo el fregadero.' },
  { slug: 'estudio-ruzafa', name: 'Estudio Ruzafa', address: 'C/ Literato Azorín 8', bedrooms: 1, bathrooms: 1, area: 42, photo: '/prop-ruzafa.svg', checklist: ['Baño', 'Cocina americana', 'Sábanas y toallas', 'Reposición', 'Regar las plantas', 'Fotos'], instructions: 'Regar las plantas con la jarra verde. Nada de lejía en la encimera de madera.' },
  { slug: 'duplex-carmen', name: 'Dúplex El Carmen', address: 'C/ Caballeros 22', bedrooms: 3, bathrooms: 2, area: 110, photo: '/prop-carmen.svg', checklist: ['Baños (2)', 'Cocina', 'Sábanas y toallas', 'Escalera y barandilla', 'Reposición', 'Fotos'], instructions: 'Empezar SIEMPRE por la planta de arriba y bajar. Los dos baños llevan amenities completos.' },
  { slug: 'apto-malvarrosa', name: 'Apartamento Malvarrosa', address: 'Av. de la Malvarrosa 57', bedrooms: 2, bathrooms: 1, area: 85, photo: '/prop-malvarrosa.svg', checklist: ['Baño', 'Cocina', 'Sábanas y toallas', 'Quitar la arena', 'Reposición', 'Fotos'], instructions: 'La ARENA es el enemigo: barrer antes de fregar y revisar la ducha.' },
  { slug: 'loft-benimaclet', name: 'Loft Benimaclet', address: 'C/ Emilio Baró 31', bedrooms: 1, bathrooms: 1, area: 55, photo: '/prop-benimaclet.svg', checklist: ['Baño', 'Cocina americana', 'Sábanas y toallas', 'Persianas y claraboya', 'Fotos'], instructions: 'Microcemento: fregona bien escurrida. El aire queda apagado y el mando en su soporte.' },
]

// [propertyIdx, checkinOffset, checkoutOffset, código, importe €, nombre huésped]
const RESERVATIONS = [
  [0, -4, 3, 'HMDEMO1AA2', 420, 'Sofía Müller'],
  [1, -1, 2, 'HMDEMO2BB3', 380, 'James O\'Connor'],
  [2, 0, 5, 'HMDEMO3CC4', 640, 'Chloé Dubois'],
  [3, 1, 6, 'HMDEMO4DD5', 590, 'Marco Rossi'],
  [4, 2, 7, 'HMDEMO5EE6', 450, 'Emma Johnson'],
  [0, 5, 12, 'HMDEMO6FF7', 810, 'Lucas Silva'],
  [1, 4, 9, 'HMDEMO7GG8', 520, 'Anna Kowalska'],
  [2, 8, 15, 'HMDEMO8HH9', 960, 'David van Dijk'],
  [3, 10, 17, 'HMDEMO9II0', 870, 'Lena Fischer'],
  [4, 12, 19, 'HMDEMO1JJ1', 640, 'Miguel Torres'],
  [0, -18, -11, 'HMDEMO2KK2', 780, 'Isabel García'],
  [2, -12, -8, 'HMDEMO3LL3', 520, 'Pierre Laurent'],
  [3, -9, -5, 'HMDEMO4MM4', 480, 'Ana Beltrán'],
]

// Personas: [name, phone, role, specialty, hourlyRate]
const PEOPLE = [
  ['María Llopis', '612 345 678', 'limpieza', 'Limpieza general', 14],
  ['Carla Vidal', '655 902 114', 'limpieza', 'Limpieza a fondo', 13],
  ['Andrés Roca', '699 412 887', 'proveedor', 'Electricidad y cerraduras', 18],
  ['Pascual Mir', '677 208 431', 'proveedor', 'Fontanería y climatización', 16],
]

// Limpiezas: [propertyIdx, reservationIdx, dateOffset (día de la limpieza), status, [assignee personIdx], estHours, checksDone, photos]
const CLEANINGS = [
  [0, 0, 3, 'pendiente', [], 2, 0, []],
  [1, 1, 2, 'en-curso', [0], 2, 3, ['/clean-1.svg']],
  [2, 2, 5, 'asignada', [1], 3, 0, []],
  [3, 3, 6, 'pendiente', [], 2, 0, []],
  [0, 5, 12, 'asignada', [0], 2, 0, []],
  [4, 4, 7, 'pendiente', [], 2, 0, []],
  // Archivadas con horas reales + materiales
  [0, 10, -10, 'archivada', [0], 2, 6, ['/clean-2.svg']],
  [2, 11, -7, 'archivada', [1], 2.5, 6, ['/clean-3.svg']],
  [3, 12, -4, 'archivada', [1], 2, 6, ['/clean-4.svg']],
]

// Mantenimiento: [propertyIdx, title, category, urgent, status, assignee personIdx, scheduledOffset, cost, notes]
const MAINTENANCE = [
  [4, 'Cambiar pilas de la cerradura Tedee', 'cerradura/pilas', 1, 'nueva', null, 2, null, 'Batería al 18 % y cerradura offline. Ir antes de la próxima entrada.'],
  [0, 'Fuga en el sifón del baño', 'fontanería', 1, 'asignada', 3, 2, null, 'Goteo bajo el lavabo. Revisar junta y sifón. Aprovechar día desocupado.'],
  [1, 'Sustituir bombillas fundidas del recibidor', 'electricidad', 0, 'asignada', 2, 4, null, 'Dos bombillas E14. Hay repuesto en el armario del tendedero.'],
  [2, 'El aire acondicionado no enfría', 'climatización', 0, 'nueva', null, 10, null, 'Huésped anterior reportó ruido y poca potencia. Revisar gas y filtros.'],
  [3, 'Reparar pata del sofá', 'mobiliario', 0, 'asignada', 2, 6, null, 'Pata trasera suelta. Reforzar con escuadras.'],
  [4, 'Persiana del dormitorio atascada', 'persianas', 0, 'finalizada', 3, null, 32, 'Cinta rota sustituida. Funciona correctamente.'],
  [0, 'Bombillas LED de la terraza', 'electricidad', 0, 'finalizada', 2, null, 18.5, 'Sustituidas por LED cálido de bajo consumo.'],
  [1, 'Grifo de cocina gotea', 'fontanería', 0, 'finalizada', 3, null, 24, 'Cambio de cartucho cerámico.'],
]

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function seedDemo(db) {
  const count = db.prepare('SELECT COUNT(*) n FROM properties').get().n
  if (count > 0) return false

  const now = Date.now()
  const today = new Date()
  const dayAt = (offset) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)

  const insProp = db.prepare(`INSERT INTO properties (id, slug, name, address, bedrooms, bathrooms, area, photo, ical_url, checklist, instructions, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`)
  const insRes = db.prepare(`INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, phone_last4, guest_name, amount, notes, created_at)
    VALUES (?, ?, ?, ?, ?, 'Reserved', ?, ?, ?, ?, ?, ?)`)
  const insPerson = db.prepare(`INSERT INTO people (id, name, phone, role, specialty, hourly_rate, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const insCleaning = db.prepare(`INSERT INTO cleanings (id, property_id, reservation_id, date, status, assignee_ids, estimated_hours, checks, photos, work_log, supplies, materials, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insMaint = db.prepare(`INSERT INTO maintenance_tasks (id, property_id, title, category, expense_tag, urgent, notes, status, assignee_id, scheduled_date, cost, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  const tx = db.transaction(() => {
    const propIds = []
    for (const p of PROPS) {
      const id = crypto.randomUUID()
      propIds.push(id)
      insProp.run(id, p.slug, p.name, p.address, p.bedrooms, p.bathrooms, p.area, p.photo, JSON.stringify(p.checklist), p.instructions, now)
    }

    const resIds = []
    for (const [pi, ci, co, code, amount, guest] of RESERVATIONS) {
      const id = crypto.randomUUID()
      resIds.push(id)
      insRes.run(id, propIds[pi], `demo-${code}@demo.local`, ymd(dayAt(ci)), ymd(dayAt(co)), code, String(1000 + pi * 1111).slice(-4), guest, amount, '', now)
    }

    const personIds = []
    for (const [name, phone, role, specialty, rate] of PEOPLE) {
      const id = crypto.randomUUID()
      personIds.push(id)
      insPerson.run(id, name, phone, role, specialty, rate, now)
    }

    for (const [pi, ri, dateOff, status, assigns, estH, checksDone, photos] of CLEANINGS) {
      const checklist = PROPS[pi].checklist
      const checks = checklist.map((label, i) => ({ id: `ck-${i}`, label, done: i < checksDone }))
      const assigneeIds = assigns.map((pi2) => personIds[pi2])
      const workLog = status === 'archivada' && assigns.length > 0
        ? assigns.map((pi2) => ({ personId: personIds[pi2], hours: estH }))
        : null
      const supplies = status === 'archivada'
        ? [{ label: 'Friegasuelos', amount: 3.5 }, { label: 'Productos de limpieza', amount: 2 }]
        : null
      const materials = supplies ? 5.5 : null
      insCleaning.run(
        crypto.randomUUID(), propIds[pi], resIds[ri], ymd(dayAt(dateOff)), status,
        JSON.stringify(assigneeIds), estH, JSON.stringify(checks), JSON.stringify(photos),
        workLog ? JSON.stringify(workLog) : '[]', supplies ? JSON.stringify(supplies) : '[]', materials, now,
      )
    }

    for (const [pi, title, cat, urgent, status, assigneeIdx, schedOff, cost, notes] of MAINTENANCE) {
      insMaint.run(
        crypto.randomUUID(), propIds[pi], title, cat, cat, urgent,
        notes, status, assigneeIdx != null ? personIds[assigneeIdx] : null,
        schedOff != null ? ymd(dayAt(schedOff)) : null, cost, now,
      )
    }

    // Usuario demo (sin contraseña: entra por /api/auth/demo)
    db.prepare('INSERT INTO users (id, username, password_hash, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('demo-user', 'demo', '', 'auto', 'demo', now)
  })
  tx()
  console.log('[demo] seed creado: 5 inmuebles, 13 reservas, 4 personas, 9 limpiezas, 8 tareas')
  return true
}
