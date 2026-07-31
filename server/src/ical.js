/**
 * Parser iCal mínimo para el export de Airbnb (VEVENT con DTSTART/DTEND;VALUE=DATE,
 * UID, SUMMARY y DESCRIPTION con "Reservation URL: …/details/<CODE>" y
 * "Phone Number (Last 4 Digits): NNNN").
 * Los eventos "Airbnb (Not available)" (bloqueos manuales) se ignoran de momento.
 */
export function parseIcs(text) {
  // Unfold: las líneas que empiezan por espacio/tab son continuación de la anterior
  const rawLines = text.split(/\r?\n/)
  const lines = []
  for (const l of rawLines) {
    if ((l.startsWith(' ') || l.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += l.slice(1)
    } else if (l.trim() !== '') {
      lines.push(l)
    }
  }

  const events = []
  let cur = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue }
    if (!cur) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).split(';')[0].toUpperCase()
    const value = line.slice(idx + 1)
    if (key === 'DTSTART') cur.dtstart = value.trim()
    else if (key === 'DTEND') cur.dtend = value.trim()
    else if (key === 'UID') cur.uid = value.trim()
    else if (key === 'SUMMARY') cur.summary = value.trim()
    else if (key === 'DESCRIPTION') cur.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\\\/g, '\\')
  }
  return events
}

function ymd(v) {
  // 20260727 → 2026-07-27
  if (!v || v.length < 8) return null
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
}

export function icsToReservations(events) {
  const out = []
  for (const e of events) {
    if (!e.uid || !e.dtstart || !e.dtend) continue
    if ((e.summary || '').toLowerCase().includes('not available')) continue
    const checkin = ymd(e.dtstart)
    const checkout = ymd(e.dtend)
    if (!checkin || !checkout) continue
    let code = ''
    let phone = ''
    if (e.description) {
      const m = e.description.match(/reservations\/details\/([A-Z0-9]+)/i)
      if (m) code = m[1]
      const p = e.description.match(/Last 4 Digits\):\s*(\d{4})/i)
      if (p) phone = p[1]
    }
    out.push({ uid: e.uid, checkin, checkout, summary: e.summary || 'Reserved', confirmation_code: code, phone_last4: phone })
  }
  return out
}

export async function fetchIcs(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
