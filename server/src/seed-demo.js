import crypto from 'node:crypto'

/**
 * Seed determinista de la BD demo (dataset de muestra, fechas relativas a hoy).
 * 5 inmuebles con checklist/instrucciones + reservas cubriendo ±1 mes.
 * Solo se ejecuta si la BD demo está vacía.
 */

const PROPS = [
  { slug: 'atico-marina', name: 'Ático Marina', address: 'C/ del Mar 14, Valencia', bedrooms: 2, bathrooms: 1, area: 78, photo: '/prop-marina.svg', checklist: ['Baño', 'Cocina', 'Sábanas y toallas', 'Reposición', 'Revisar terraza', 'Fotos'], instructions: 'Entrar por el portal B (2ºB, llave en la caja del tendedero, código 1420). La terraza se limpia SIEMPRE. Productos bajo el fregadero.' },
  { slug: 'estudio-ruzafa', name: 'Estudio Ruzafa', address: 'C/ Literato Azorín 8', bedrooms: 1, bathrooms: 1, area: 42, photo: '/prop-ruzafa.svg', checklist: ['Baño', 'Cocina americana', 'Sábanas y toallas', 'Reposición', 'Regar las plantas', 'Fotos'], instructions: 'Regar las plantas con la jarra verde. Nada de lejía en la encimera de madera.' },
  { slug: 'duplex-carmen', name: 'Dúplex El Carmen', address: 'C/ Caballeros 22', bedrooms: 3, bathrooms: 2, area: 110, photo: '/prop-carmen.svg', checklist: ['Baños (2)', 'Cocina', 'Sábanas y toallas', 'Escalera y barandilla', 'Reposición', 'Fotos'], instructions: 'Empezar SIEMPRE por la planta de arriba y bajar. Los dos baños llevan amenities completos.' },
  { slug: 'apto-malvarrosa', name: 'Apartamento Malvarrosa', address: 'Av. de la Malvarrosa 57', bedrooms: 2, bathrooms: 1, area: 85, photo: '/prop-malvarrosa.svg', checklist: ['Baño', 'Cocina', 'Sábanas y toallas', 'Quitar la arena', 'Reposición', 'Fotos'], instructions: 'La ARENA es el enemigo: barrer antes de fregar y revisar la ducha.' },
  { slug: 'loft-benimaclet', name: 'Loft Benimaclet', address: 'C/ Emilio Baró 31', bedrooms: 1, bathrooms: 1, area: 55, photo: '/prop-benimaclet.svg', checklist: ['Baño', 'Cocina americana', 'Sábanas y toallas', 'Persianas y claraboya', 'Fotos'], instructions: 'Microcemento: fregona bien escurrida. El aire queda apagado y el mando en su soporte.' },
]

// [propertyIdx, checkinOffset, checkoutOffset, código]
const RESERVATIONS = [
  [0, -4, 3, 'HMDEMO1AA2'],
  [1, -1, 2, 'HMDEMO2BB3'],
  [2, 0, 5, 'HMDEMO3CC4'],
  [3, 1, 6, 'HMDEMO4DD5'],
  [4, 2, 7, 'HMDEMO5EE6'],
  [0, 5, 12, 'HMDEMO6FF7'],
  [1, 4, 9, 'HMDEMO7GG8'],
  [2, 8, 15, 'HMDEMO8HH9'],
  [3, 10, 17, 'HMDEMO9II0'],
  [4, 12, 19, 'HMDEMO1JJ1'],
  [0, -18, -11, 'HMDEMO2KK2'],
  [2, -12, -8, 'HMDEMO3LL3'],
  [3, -9, -5, 'HMDEMO4MM4'],
]

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function seedDemo(db) {
  const count = db.prepare('SELECT COUNT(*) n FROM properties').get().n
  if (count > 0) return false

  const now = Date.now()
  const today = new Date()
  const insProp = db.prepare(`INSERT INTO properties (id, slug, name, address, bedrooms, bathrooms, area, photo, ical_url, checklist, instructions, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`)
  const insRes = db.prepare(`INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, phone_last4, created_at)
    VALUES (?, ?, ?, ?, ?, 'Reserved', ?, ?, ?)`)

  const tx = db.transaction(() => {
    const propIds = []
    for (const p of PROPS) {
      const id = crypto.randomUUID()
      propIds.push(id)
      insProp.run(id, p.slug, p.name, p.address, p.bedrooms, p.bathrooms, p.area, p.photo, JSON.stringify(p.checklist), p.instructions, now)
    }
    for (const [pi, ci, co, code] of RESERVATIONS) {
      const checkin = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ci)
      const checkout = new Date(today.getFullYear(), today.getMonth(), today.getDate() + co)
      insRes.run(crypto.randomUUID(), propIds[pi], `demo-${code}@demo.local`, ymd(checkin), ymd(checkout), code, String(1000 + pi * 1111).slice(-4), now)
    }
    // Usuario demo (sin contraseña: entra por /api/auth/demo)
    db.prepare('INSERT INTO users (id, username, password_hash, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('demo-user', 'demo', '', 'auto', 'demo', now)
  })
  tx()
  console.log('[demo] seed creado: 5 inmuebles, 13 reservas')
  return true
}
