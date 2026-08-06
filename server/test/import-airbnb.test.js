import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { importAirbnb, parseAirbnbCsv } from '../src/import-airbnb.js';
import { syncAll } from '../src/sync.js';

const CSV = `﻿日期,最晚到账日期,类型,确认码,预订日期,开始日期,截止日期,夜,客人,房源,详细信息,参考码,货币,金额,已发放款项,服务费,快捷收款手续费,清洁费,总收入,爱彼迎汇缴税款,收入年份
07/28/2026,08/04/2026,Payout,,,,,,,,"转至Test User, IBAN 0000 (EUR)",,EUR,,1500.00,,,,,,
07/28/2026,,预订,HMTEST0001,11/06/2025,07/27/2026,08/03/2026,7,John Smith,Casa de prueba Uno,,,EUR,1500.00,,65.70,,90.00,1590.00,0.00,2026
07/28/2026,,预订,HMTEST0001,11/06/2025,07/27/2026,08/03/2026,7,John Smith,Casa de prueba Uno,,,EUR,1510.00,,65.70,,90.00,1600.00,0.00,2026
07/20/2026,,预订,HMTEST0002,06/01/2026,07/17/2026,07/31/2026,14,"Ejemplo, María",Piso de prueba Dos,,,EUR,"1,234.50",,,,,,2026
07/01/2026,,调解款结算,HMTEST0003,,05/01/2026,05/03/2026,2,Pepe,Casa de prueba Uno,,,EUR,50.00,,,,,0.00,2026
`;

let dir;
let db;

const ymd = (d) => d.toISOString().slice(0, 10);
const daysFrom = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-import-test-'));
  db = openDb(dir, 'test.db');
  db.prepare(`INSERT INTO properties (id, slug, name, created_at) VALUES ('prop-chalet', 'chalet', 'Prop Test 1', 1), ('prop-dos', 'dos', 'Prop Test 2', 1)`).run();
  // Reserva ya existente (vino del iCal) FUTURA y sin cancelar: debe casar por
  // confirmation_code y, si no vuelve a venir en el feed, se borra (cancelada).
  db.prepare(`INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, confirmation_code, created_at)
              VALUES ('r1', 'prop-chalet', 'abc@airbnb.com', ?, ?, 'Reserved', 'HMTEST0001', 1)`).run(ymd(daysFrom(20)), ymd(daysFrom(25)));
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('parseAirbnbCsv', () => {
  it('parsea cabeceras chinas, filtra no-reservas y deduplica sumando plazos', () => {
    const { reservations, dupes, skipped, error } = parseAirbnbCsv(CSV);
    expect(error).toBeNull();
    expect(reservations).toHaveLength(2); // HMTEST0001 dedup + HMTEST0002; payout y 调解款结算 fuera
    expect(dupes).toBe(1);
    expect(skipped).toBe(2);
    const r1 = reservations.find((r) => r.code === 'HMTEST0001');
    expect(r1.amount).toBe(3010.0); // pagos parciales sumados: 1500 + 1510
    expect(r1.checkin).toBe('2026-07-27');
    expect(r1.checkout).toBe('2026-08-03');
    const r2 = reservations.find((r) => r.code === 'HMTEST0002');
    expect(r2.guest).toBe('Ejemplo, María'); // comillas con coma
    expect(r2.amount).toBe(1234.5); // separador de miles
  });

  it('rechaza CSV sin las columnas esperadas', () => {
    const { error } = parseAirbnbCsv('a,b,c\n1,2,3\n');
    expect(error).toContain('columnas no reconocidas');
  });
});

describe('importAirbnb', () => {
  const MAP = { 'Casa de prueba Uno': 'prop-chalet', 'Piso de prueba Dos': 'prop-dos' };

  it('dry=true solo previsualiza (no escribe)', () => {
    const { reservations } = parseAirbnbCsv(CSV);
    const out = importAirbnb(db, reservations, MAP, true);
    expect(out.matched).toBe(1);
    expect(out.inserted).toBe(1);
    expect(out.unmapped).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) n FROM reservations').get().n).toBe(1); // intacta
  });

  it('dry=false aplica: match actualiza guest+amount, nueva inserta con uid csv-', () => {
    const { reservations } = parseAirbnbCsv(CSV);
    const out = importAirbnb(db, reservations, MAP, false);
    expect(out.matched).toBe(1);
    expect(out.inserted).toBe(1);
    const r1 = db.prepare('SELECT * FROM reservations WHERE confirmation_code = ?').get('HMTEST0001');
    expect(r1.guest_name).toBe('John Smith');
    expect(r1.amount).toBe(3010.0);
    expect(r1.uid).toBe('abc@airbnb.com'); // uid iCal conservado
    const r2 = db.prepare('SELECT * FROM reservations WHERE confirmation_code = ?').get('HMTEST0002');
    expect(r2.uid).toBe('csv-HMTEST0002');
    expect(r2.guest_name).toBe('Ejemplo, María');
    expect(r2.property_id).toBe('prop-dos');
  });

  it('re-importar es idempotente: 0 inserts, todo matches', () => {
    const { reservations } = parseAirbnbCsv(CSV);
    const out = importAirbnb(db, reservations, MAP, false);
    expect(out.inserted).toBe(0);
    expect(out.matched).toBe(2);
    expect(db.prepare('SELECT COUNT(*) n FROM reservations').get().n).toBe(2);
  });

  it('listings sin mapear se reportan y no se insertan', () => {
    const { reservations } = parseAirbnbCsv(CSV);
    const out = importAirbnb(db, reservations, {}, false);
    expect(out.unmapped.sort()).toEqual(['Casa de prueba Uno', 'Piso de prueba Dos'].sort());
    expect(db.prepare('SELECT COUNT(*) n FROM reservations').get().n).toBe(2); // las de antes
  });
});

describe('sync iCal vs reservas CSV', () => {
  it('el sync borra uds iCal obsoletos pero NO los csv-', async () => {
    // ICS con UNA sola reserva (la otra iCal existente, 'abc@airbnb.com', quedará obsoleta)
    const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:nueva-uid@airbnb.com\nDTSTART;VALUE=DATE:20260810\nDTEND;VALUE=DATE:20260815\nSUMMARY:Reserved\nDESCRIPTION:Reservation URL: https://www.airbnb.com/h/HMNEW12345\\nPhone (Last 4 Digits): 1234\nEND:VEVENT\nEND:VCALENDAR`;
    const server = createServer((req, res) => { res.end(ics) });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    db.prepare("UPDATE properties SET ical_url = ? WHERE id = 'prop-chalet'")
      .run(`http://127.0.0.1:${server.address().port}/cal.ics`);

    await syncAll(db);
    server.close();

    const uids = db.prepare("SELECT uid FROM reservations WHERE property_id = 'prop-chalet'").all().map((r) => r.uid);
    expect(uids).toContain('nueva-uid@airbnb.com'); // upsert
    expect(uids).not.toContain('abc@airbnb.com'); // iCal obsoleto borrado
    // la reserva CSV del segundo inmueble sigue intacta
    expect(db.prepare("SELECT COUNT(*) n FROM reservations WHERE uid = 'csv-HMTEST0002'").get().n).toBe(1);
  });
});
