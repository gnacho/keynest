import crypto from 'node:crypto'

/**
 * Importador del CSV de "Historial de transacciones" de Airbnb.
 *
 * - Parser propio (sin dependencias): BOM utf-8-sig, campos con comillas.
 * - Cabeceras en el idioma de la cuenta (chino verificado; inglés aceptado).
 * - Filtra filas tipo reserva (预订 / Reservation), deduplica por código SUMANDO
 *   importes: Airbnb paga las estancias largas en plazos mensuales y cada plazo
 *   es una fila 预订 con el MISMO código y las MISMAS fechas (verificado en los
 *   CSV reales del usuario: 100% de los códigos duplicados comparten fechas).
 * - El mapa listing→propertyId NO vive en el código (repo público):
 *   llega por petición (la UI lo pide cuando hay listings sin mapear).
 */

const HEADERS = {
  date: ['日期', 'Date'],
  type: ['类型', 'Type'],
  code: ['确认码', 'Confirmation Code'],
  booked: ['预订日期', 'Booking Date'],
  start: ['开始日期', 'Start Date'],
  end: ['截止日期', 'End Date'],
  guest: ['客人', 'Guest'],
  listing: ['房源', 'Listing'],
  amount: ['金额', 'Amount'],
}
const RESERVATION_TYPES = new Set(['预订', 'Reservation'])

function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  const push = () => { row.push(field); field = '' }
  const pushRow = () => { push(); if (row.length > 1 || row[0] !== '') rows.push(row); row = [] }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') push()
    else if (ch === '\n') pushRow()
    else if (ch !== '\r') field += ch
  }
  pushRow()
  return rows
}

function toIso(mmddyyyy) {
  const m = mmddyyyy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

function toNum(s) {
  const n = parseFloat(String(s || '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Parsea el CSV y devuelve reservas únicas por código (pagos parciales sumados). */
export function parseAirbnbCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''))
  if (rows.length < 2) return { reservations: [], dupes: 0, skipped: 0, error: 'vacío' }
  const header = rows[0].map((h) => h.trim())
  const idx = {}
  for (const [key, names] of Object.entries(HEADERS)) {
    idx[key] = header.findIndex((h) => names.includes(h))
  }
  const missing = ['type', 'code', 'start', 'end', 'guest', 'listing', 'amount'].filter((k) => idx[k] === -1)
  if (missing.length) return { reservations: [], dupes: 0, skipped: 0, error: `columnas no reconocidas: ${missing.join(', ')}` }

  let dupes = 0
  let skipped = 0
  const byCode = new Map()
  for (const r of rows.slice(1)) {
    if (!RESERVATION_TYPES.has((r[idx.type] || '').trim())) { skipped++; continue }
    const code = (r[idx.code] || '').trim()
    if (!code) { skipped++; continue }
    const amount = toNum(r[idx.amount])
    if (byCode.has(code)) {
      // Plazo adicional de la misma reserva (mismas fechas): el importe se suma.
      dupes++
      const prev = byCode.get(code)
      prev.amount = Math.round((prev.amount + amount) * 100) / 100
      continue
    }
    byCode.set(code, {
      code,
      bookedDate: idx.booked >= 0 ? toIso(r[idx.booked] || '') : null,
      checkin: toIso(r[idx.start] || ''),
      checkout: toIso(r[idx.end] || ''),
      guest: (r[idx.guest] || '').trim(),
      listing: (r[idx.listing] || '').trim(),
      amount: toNum(r[idx.amount]),
    })
  }
  const reservations = [...byCode.values()].filter((r) => r.checkin && r.checkout)
  return { reservations, dupes, skipped, error: null }
}

/**
 * Cruza las reservas del CSV con la BD.
 * map: { listingName: propertyId } (listings sin entrada quedan en `unmapped`).
 * dry=true → solo vista previa. dry=false → aplica (update matches, insert nuevas).
 * Idempotente: re-importar solo actualiza guest_name/amount de los matches.
 */
export function importAirbnb(db, reservations, map, dry = true) {
  const out = {
    matched: 0, inserted: 0, updated: 0, unmapped: [], totalMatched: 0, totalInserted: 0,
    byProperty: {}, warnings: [],
  }
  const unmappedSet = new Set()
  const tx = db.transaction(() => {
    for (const r of reservations) {
      const propertyId = map[r.listing]
      if (!propertyId) { unmappedSet.add(r.listing); continue }
      const existing = db.prepare('SELECT id, guest_name, amount FROM reservations WHERE confirmation_code = ?').get(r.code)
      if (existing) {
        out.matched++
        out.totalMatched += r.amount
        if (!dry) {
          db.prepare('UPDATE reservations SET guest_name = ?, amount = ?, booked_date = COALESCE(?, booked_date) WHERE id = ?')
            .run(r.guest, r.amount, r.bookedDate, existing.id)
          out.updated++
        }
      } else {
        out.inserted++
        out.totalInserted += r.amount
        out.byProperty[propertyId] = (out.byProperty[propertyId] || 0) + 1
        if (!dry) {
          db.prepare(`INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, phone_last4, amount, guest_name, booked_date, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`)
            .run(crypto.randomUUID(), propertyId, `csv-${r.code}`, r.checkin, r.checkout, 'CSV Airbnb', r.code, r.amount, r.guest, r.bookedDate ?? '', Date.now())
        }
      }
    }
    if (dry) throw new Error('__dry__') // rollback de la vista previa
  })
  try { tx() } catch (err) { if (err.message !== '__dry__') throw err }
  out.unmapped = [...unmappedSet]
  return out
}
