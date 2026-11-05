import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import type { DB } from '../src/db.js';
import { hoyLocal } from '../src/alerts.js';

vi.mock('../src/ical.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, any>;
  return { ...actual, fetchIcs: vi.fn() };
});
import { fetchIcs } from '../src/ical.js';
import { syncAll } from '../src/sync.js';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysFrom = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};
const icsDT = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

// Feed con SOLO una reserva futura. La pasada ya no viene (Airbnb solo lista
// actuales/futuras), y una futura cancelada tampoco.
function feedWith(events: string[]) {
  return `BEGIN:VCALENDAR
VERSION:2.0
${events.join('\n')}
END:VCALENDAR`;
}

describe('syncAll — conservación de reservas finalizadas (issue #21)', () => {
  let dir: string, db: DB;

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

    (fetchIcs as any).mockResolvedValue(feedWith([
      `BEGIN:VEVENT
DTSTART;VALUE=DATE:${icsDT(daysFrom(10))}
DTEND;VALUE=DATE:${icsDT(daysFrom(20))}
SUMMARY:Reserved
UID:future@airbnb.com
END:VEVENT`,
    ]));

    await syncAll(db);

    const uids = (db.prepare('SELECT uid FROM reservations').all() as Array<{ uid: string }>).map((r) => r.uid).sort();
    expect(uids).toContain('past@airbnb.com'); // NO se borra la pasada
    expect(uids).toContain('future@airbnb.com'); // la futura sigue
  });

  it('borra una reserva futura cancelada (no viene en el feed)', async () => {
    db.prepare("DELETE FROM reservations").run();
    const futuro = ymd(daysFrom(5));
    db.prepare("INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, created_at) VALUES ('r-cancelada','p1','cancelled@airbnb.com',?,?,'Reserved',0)").run(futuro, futuro);

    (fetchIcs as any).mockResolvedValue(feedWith([])); // feed vacío

    await syncAll(db);

    const uids = (db.prepare('SELECT uid FROM reservations').all() as Array<{ uid: string }>).map((r) => r.uid);
    expect(uids).not.toContain('cancelled@airbnb.com');
  });

  it('conserva reservas CSV pasadas (comportamiento previo intacto)', async () => {
    db.prepare("DELETE FROM reservations").run();
    const pasado = ymd(daysFrom(-3));
    db.prepare("INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, created_at) VALUES ('r-csv','p1','csv-ABC123',?,?,'CSV Airbnb',0)").run(pasado, pasado);

    (fetchIcs as any).mockResolvedValue(feedWith([]));

    await syncAll(db);

    const uids = (db.prepare('SELECT uid FROM reservations').all() as Array<{ uid: string }>).map((r) => r.uid);
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
    (fetchIcs as any).mockResolvedValue(feedWith([
      'BEGIN:VEVENT',
      `DTSTART;VALUE=DATE:${icsDT(daysFrom(10))}`,
      `DTEND;VALUE=DATE:${icsDT(daysFrom(13))}`,
      'UID:shared@airbnb.com',
      'SUMMARY:Reserved',
      'END:VEVENT',
    ]));
    // El feed de p2 contiene el mismo UID → no debe mover la reserva a p2
    await syncAll(db);
    const row = db.prepare("SELECT property_id FROM reservations WHERE uid = 'shared@airbnb.com'").get() as { property_id: string };
    expect(row.property_id).toBe('p1');
  });

  it('marca una reserva nueva del feed como pendiente de sincronización Airbnb', async () => {
    db.prepare("DELETE FROM reservations").run();
    (fetchIcs as any).mockResolvedValue(feedWith([
      'BEGIN:VEVENT',
      `DTSTART;VALUE=DATE:${icsDT(daysFrom(10))}`,
      `DTEND;VALUE=DATE:${icsDT(daysFrom(13))}`,
      'UID:nueva-sync-state@airbnb.com',
      'SUMMARY:Reserved',
      'END:VEVENT',
    ]));

    await syncAll(db);

    const row = db.prepare("SELECT airbnb_sync_state FROM reservations WHERE uid = 'nueva-sync-state@airbnb.com'").get() as { airbnb_sync_state: string };
    expect(row.airbnb_sync_state).toBe('pending');
  });
});

describe('syncAll — cancelación en cascada (issue #334)', () => {
  let dir: string, db: DB;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'keynest-sync-cancel-'));
    db = openDb(dir);
    db.prepare("INSERT INTO properties (id, slug, name, ical_url, created_at) VALUES ('p1','p1','Casa','http://feed.test/ical.ics',0)").run();
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const limpia = () => {
    for (const t of ['reservation_payments', 'cleanings', 'reservations', 'audit_log']) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM kv WHERE key = 'canceladas'").run();
  };

  const insertaCancelable = () => {
    const entrada = ymd(daysFrom(30));
    const salida = ymd(daysFrom(40));
    db.prepare(
      `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code,
        guest_name, amount, airbnb_status, airbnb_sync_state, created_at)
       VALUES ('r-cascada','p1','cascada@airbnb.com',?,?,'Reserved','HMCASCADA','Lisa Buchter',5434.3,'upcoming','matched',0)`,
    ).run(entrada, salida);
    // Pago con reservation_id obsoleto (el caso real de HM5ZWXMCJK) y otro correcto.
    db.prepare(
      `INSERT INTO reservation_payments (id, reservation_id, confirmation_code, paid_on, amount, currency, status, external_ref, detected_at)
       VALUES ('pay-huerfano','id-muerto','HMCASCADA',?,2441.5,'EUR','SCHEDULED','ext-1',0)`,
    ).run(ymd(daysFrom(31)));
    db.prepare(
      `INSERT INTO reservation_payments (id, reservation_id, confirmation_code, paid_on, amount, currency, status, external_ref, detected_at)
       VALUES ('pay-ok','r-cascada','HMCASCADA',?,2205.22,'EUR','SCHEDULED','ext-2',0)`,
    ).run(ymd(daysFrom(32)));
    db.prepare(
      `INSERT INTO cleanings (id, property_id, reservation_id, date, status, created_at)
       VALUES ('limp-1','p1','r-cascada',?,'pending',0)`,
    ).run(salida);
    return { entrada, salida };
  };

  it('borra reserva, pagos y limpiezas, deja tombstone y audit, y avisa', async () => {
    limpia();
    const { entrada, salida } = insertaCancelable();
    const onCancelled = vi.fn();
    (fetchIcs as any).mockResolvedValue(feedWith([]));

    await syncAll(db, { onCancelled });

    expect(db.prepare("SELECT COUNT(*) n FROM reservations WHERE uid = 'cascada@airbnb.com'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM reservation_payments WHERE confirmation_code = 'HMCASCADA'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM cleanings WHERE reservation_id = 'r-cascada'").get()).toEqual({ n: 0 });
    const audit = db.prepare("SELECT user_id, action, entity, entity_id FROM audit_log WHERE action = 'cancel'").get() as Record<string, any>;
    expect(audit).toMatchObject({ user_id: null, action: 'cancel', entity: 'reservation', entity_id: 'r-cascada' });
    const tomb = JSON.parse((db.prepare("SELECT value FROM kv WHERE key = 'canceladas'").get() as { value: string }).value);
    expect(tomb.some((t: any) => t.uid === 'cascada@airbnb.com' && t.code === 'HMCASCADA')).toBe(true);

    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(onCancelled).toHaveBeenCalledWith(
      'Casa',
      [expect.objectContaining({
        reservationId: 'r-cascada',
        propertyName: 'Casa',
        confirmationCode: 'HMCASCADA',
        guestName: 'Lisa Buchter',
        amount: 5434.3,
        checkin: entrada,
        checkout: salida,
        matched: true,
      })],
    );
  });

  it('un feed desfasado no resucita la reserva cancelada', async () => {
    limpia();
    insertaCancelable();
    (fetchIcs as any).mockResolvedValue(feedWith([]));
    await syncAll(db);

    // El mismo evento vuelve a aparecer en el iCal (caché de Airbnb).
    (fetchIcs as any).mockResolvedValue(feedWith([
      'BEGIN:VEVENT',
      `DTSTART;VALUE=DATE:${icsDT(daysFrom(30))}`,
      `DTEND;VALUE=DATE:${icsDT(daysFrom(40))}`,
      'UID:cascada@airbnb.com',
      'SUMMARY:Reserved',
      'END:VEVENT',
    ]));
    await syncAll(db);

    expect(db.prepare("SELECT COUNT(*) n FROM reservations WHERE uid = 'cascada@airbnb.com'").get()).toEqual({ n: 0 });
  });

  it('una solicitud nunca confirmada se limpia pero NO se avisa como cancelación', async () => {
    limpia();
    const entrada = ymd(daysFrom(10));
    db.prepare(
      `INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, airbnb_sync_state, created_at)
       VALUES ('r-solicitud','p1','solicitud@airbnb.com',?,?,'Reserved','HMSOLICITUD','pending',0)`,
    ).run(entrada, entrada);
    const onCancelled = vi.fn();
    (fetchIcs as any).mockResolvedValue(feedWith([]));

    await syncAll(db, { onCancelled });

    expect(db.prepare("SELECT COUNT(*) n FROM reservations WHERE uid = 'solicitud@airbnb.com'").get()).toEqual({ n: 0 });
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
