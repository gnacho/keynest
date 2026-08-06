import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { hoyLocal } from '../src/alerts.js';

vi.mock('../src/ical.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchIcs: vi.fn() };
});
import { fetchIcs } from '../src/ical.js';
import { syncAll } from '../src/sync.js';

const ymd = (d) => d.toISOString().slice(0, 10);
const daysFrom = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};
const icsDT = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

// Feed con SOLO una reserva futura. La pasada ya no viene (Airbnb solo lista
// actuales/futuras), y una futura cancelada tampoco.
function feedWith(events) {
  return `BEGIN:VCALENDAR
VERSION:2.0
${events.join('\n')}
END:VCALENDAR`;
}

describe('syncAll — conservación de reservas finalizadas (issue #21)', () => {
  let dir, db;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'keynest-sync-'));
    db = openDb(dir);
    db.prepare("INSERT INTO properties (id, slug, name, ical_url, created_at) VALUES ('p1','p1','Casa','http://feed.test/ical.ics',0)").run();
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('conserva una reserva pasada (@airbnb.com) que ya no viene en el feed', async () => {
    db.prepare("DELETE FROM reservations").run();
    const pasado = ymd(daysFrom(-5));
    const futuro = ymd(daysFrom(10));
    db.prepare("INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, created_at) VALUES ('r-pasada','p1','past@airbnb.com',?,?,'Reserved',0)").run(pasado, pasado);
    db.prepare("INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, created_at) VALUES ('r-futura','p1','future@airbnb.com',?,?,'Reserved',0)").run(futuro, futuro);

    fetchIcs.mockResolvedValue(feedWith([
      `BEGIN:VEVENT
DTSTART;VALUE=DATE:${icsDT(daysFrom(10))}
DTEND;VALUE=DATE:${icsDT(daysFrom(20))}
SUMMARY:Reserved
UID:future@airbnb.com
END:VEVENT`,
    ]));

    await syncAll(db);

    const uids = db.prepare('SELECT uid FROM reservations').all().map((r) => r.uid).sort();
    expect(uids).toContain('past@airbnb.com'); // NO se borra la pasada
    expect(uids).toContain('future@airbnb.com'); // la futura sigue
  });

  it('borra una reserva futura cancelada (no viene en el feed)', async () => {
    db.prepare("DELETE FROM reservations").run();
    const futuro = ymd(daysFrom(5));
    db.prepare("INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, created_at) VALUES ('r-cancelada','p1','cancelled@airbnb.com',?,?,'Reserved',0)").run(futuro, futuro);

    fetchIcs.mockResolvedValue(feedWith([])); // feed vacío

    await syncAll(db);

    const uids = db.prepare('SELECT uid FROM reservations').all().map((r) => r.uid);
    expect(uids).not.toContain('cancelled@airbnb.com');
  });

  it('conserva reservas CSV pasadas (comportamiento previo intacto)', async () => {
    db.prepare("DELETE FROM reservations").run();
    const pasado = ymd(daysFrom(-3));
    db.prepare("INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, created_at) VALUES ('r-csv','p1','csv-ABC123',?,?,'CSV Airbnb',0)").run(pasado, pasado);

    fetchIcs.mockResolvedValue(feedWith([]));

    await syncAll(db);

    const uids = db.prepare('SELECT uid FROM reservations').all().map((r) => r.uid);
    expect(uids).toContain('csv-ABC123');
  });

  it('usa la fecha local del negocio para el corte (hoyLocal)', () => {
    expect(hoyLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('un UID compartido entre dos propiedades NO migra la reserva (auditoría bugs)', async () => {
    db.prepare("DELETE FROM reservations").run();
    db.prepare("INSERT INTO properties (id, slug, name, ical_url, created_at) VALUES ('p2','p2','Piso 2','http://feed.test/p2.ics',0)").run();
    const futuro = ymd(daysFrom(10));
    // p1 ya tiene la reserva con ese UID (misma reserva compartida en el feed de p2)
    db.prepare("INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, created_at) VALUES ('r-p1','p1','shared@airbnb.com',?,?,'Reserved',0)").run(futuro, futuro);
    fetchIcs.mockResolvedValue(feedWith([
      'BEGIN:VEVENT',
      `DTSTART;VALUE=DATE:${icsDT(daysFrom(10))}`,
      `DTEND;VALUE=DATE:${icsDT(daysFrom(13))}`,
      'UID:shared@airbnb.com',
      'SUMMARY:Reserved',
      'END:VEVENT',
    ]));
    // El feed de p2 contiene el mismo UID → no debe mover la reserva a p2
    await syncAll(db);
    const row = db.prepare("SELECT property_id FROM reservations WHERE uid = 'shared@airbnb.com'").get();
    expect(row.property_id).toBe('p1');
  });
});
