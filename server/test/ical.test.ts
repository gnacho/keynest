import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { fetchIcs, icsToReservations, parseIcs } from '../src/ical.js';

const ICS = `BEGIN:VCALENDAR
PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260727
DTEND;VALUE=DATE:20260803
SUMMARY:Reserved
UID:abc123@airbnb.com
DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de
 tails/HMNETDBM8D\\nPhone Number (Last 4 Digits): 4045
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260803
DTEND;VALUE=DATE:20260824
SUMMARY:Airbnb (Not available)
UID:block456@airbnb.com
END:VEVENT
END:VCALENDAR`;

describe('parseIcs', () => {
  it('parsea eventos con líneas plegadas (folding)', () => {
    const events = parseIcs(ICS);
    expect(events).toHaveLength(2);
    expect(events[0].uid).toBe('abc123@airbnb.com');
    expect(events[0].description).toContain('HMNETDBM8D');
  });
});

describe('icsToReservations', () => {
  it('extrae fechas, código de reserva y teléfono; salta bloqueos', () => {
    const res = icsToReservations(parseIcs(ICS));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      checkin: '2026-07-27',
      checkout: '2026-08-03',
      confirmation_code: 'HMNETDBM8D',
      phone_last4: '4045',
    });
  });
});

describe('fetchIcs destination policy', () => {
  it('rejects a non-HTTPS calendar before connecting', async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.end('BEGIN:VCALENDAR');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    try {
      await expect(fetchIcs(`http://127.0.0.1:${address.port}/calendar`)).rejects.toThrow(/HTTPS/);
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
