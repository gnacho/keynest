/**
 * Parser iCal mínimo para el export de Airbnb (VEVENT con DTSTART/DTEND;VALUE=DATE,
 * UID, SUMMARY y DESCRIPTION con "Reservation URL: …/details/<CODE>" y
 * "Phone Number (Last 4 Digits): NNNN").
 * Los eventos "Airbnb (Not available)" (bloqueos manuales) se ignoran de momento.
 */
import { fetchPublicText } from './outbound.js'

export interface IcsEvent {
  uid?: string
  dtstart?: string
  dtend?: string
  summary?: string
  description?: string
}

export function parseIcs(text: string): IcsEvent[] {
  // Unfold: las líneas que empiezan por espacio/tab son continuación de la anterior
  const rawLines = text.split(/\r?\n/)
  const lines: string[] = []
  for (const l of rawLines) {
    if ((l.startsWith(' ') || l.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += l.slice(1)
    } else if (l.trim() !== '') {
      lines.push(l)
    }
  }

  const events: IcsEvent[] = []
  let cur: IcsEvent | null = null
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

function ymd(v: string): string | null {
  // 20260727 → 2026-07-27
  if (!v || v.length < 8) return null
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
}

export interface IcsReservation {
  uid: string
  checkin: string
  checkout: string
  summary: string
  confirmation_code: string
  phone_last4: string
}

export function icsToReservations(events: IcsEvent[]): IcsReservation[] {
  const out: IcsReservation[] = []
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

export async function fetchIcs(url: string): Promise<string> {
  return fetchPublicText(url, { timeoutMs: 20000, maxBytes: 5 * 1024 * 1024 })
}
