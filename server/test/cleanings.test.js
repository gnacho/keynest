import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, hydrateCleaning } from '../src/db.js';

let dir;
let db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-cleanings-'));
  db = openDb(dir);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function insertProperty(id, { checklist = [], instructions = '' } = {}) {
  db.prepare(
    `INSERT INTO properties (id, slug, name, checklist, instructions, created_at)
     VALUES (?, ?, ?, ?, ?, 0)`,
  ).run(id, id, id, JSON.stringify(checklist), instructions);
}

function insertCleaning(id, propertyId, { checks = '[]', instructions = null, status = 'pendiente' } = {}) {
  db.prepare(
    `INSERT INTO cleanings (id, property_id, date, status, assignee_ids, estimated_hours, checks, instructions, photos, created_at)
     VALUES (?, ?, '2026-08-10', ?, '[]', 2, ?, ?, '[]', 0)`,
  ).run(id, propertyId, status, checks, instructions);
}

describe('issue #39 — snapshot de checklist + instrucciones por limpieza', () => {
  it('la migración 14 añade cleanings.instructions con DEFAULT ""', () => {
    const cols = db.prepare("PRAGMA table_info(cleanings)").all().map((c) => c.name);
    expect(cols).toContain('instructions');
    // INSERT legacy pre-migración: no menciona la columna → aplica el DEFAULT ''
    db.prepare(
      `INSERT INTO cleanings (id, property_id, date, status, assignee_ids, estimated_hours, checks, photos, created_at)
       VALUES ('c-default', 'p1', '2026-08-10', 'pendiente', '[]', 2, '[]', '[]', 0)`,
    ).run();
    const row = db.prepare('SELECT instructions FROM cleanings WHERE id = ?').get('c-default');
    expect(row.instructions).toBe('');
  });

  it('hydrateCleaning hidrata checks e instrucciones de una limpieza vacía', () => {
    insertProperty('p1', { checklist: ['Baño', 'Cocina'], instructions: 'Entrar por el portal B.' });
    insertCleaning('c-empty', 'p1', { checks: '[]', instructions: null });
    const cl = db.prepare('SELECT * FROM cleanings WHERE id = ?').get('c-empty');
    const props = db.prepare('SELECT * FROM properties').all().map((p) => ({ ...p, checklist: JSON.parse(p.checklist || '[]') }));
    const out = hydrateCleaning({ ...cl }, props);
    expect(JSON.parse(out.checks)).toEqual([
      { id: 'chk-0', label: 'Baño', done: false },
      { id: 'chk-1', label: 'Cocina', done: false },
    ]);
    expect(out.instructions).toBe('Entrar por el portal B.');
  });

  it('hydrateCleaning NO pisa las instrucciones propias de la limpieza', () => {
    insertProperty('p2', { checklist: ['Suelo'], instructions: 'ORIGINAL DEL INMUEBLE' });
    insertCleaning('c-custom', 'p2', { instructions: 'Esta vez no fregar la terraza' });
    const cl = db.prepare('SELECT * FROM cleanings WHERE id = ?').get('c-custom');
    const props = db.prepare('SELECT * FROM properties').all().map((p) => ({ ...p, checklist: JSON.parse(p.checklist || '[]') }));
    const out = hydrateCleaning({ ...cl }, props);
    expect(out.instructions).toBe('Esta vez no fregar la terraza');
  });

  it('hydrateCleaning NO pisa los checks propios de la limpieza', () => {
    insertCleaning('c-checks', 'p1', { checks: JSON.stringify([{ id: 'x', label: 'Extra', done: true }]) });
    const cl = db.prepare('SELECT * FROM cleanings WHERE id = ?').get('c-checks');
    const props = db.prepare('SELECT * FROM properties').all().map((p) => ({ ...p, checklist: JSON.parse(p.checklist || '[]') }));
    const out = hydrateCleaning({ ...cl }, props);
    expect(JSON.parse(out.checks)).toEqual([{ id: 'x', label: 'Extra', done: true }]);
  });

  it('hydrateCleaning NO modifica el inmueble maestro', () => {
    insertProperty('p3', { checklist: ['A'], instructions: 'MAESTRO' });
    insertCleaning('c-maestro', 'p3', { instructions: null });
    const propsBefore = db.prepare('SELECT instructions FROM properties WHERE id = ?').get('p3');
    const cl = db.prepare('SELECT * FROM cleanings WHERE id = ?').get('c-maestro');
    const props = db.prepare('SELECT * FROM properties').all().map((p) => ({ ...p, checklist: JSON.parse(p.checklist || '[]') }));
    hydrateCleaning({ ...cl }, props);
    const propsAfter = db.prepare('SELECT instructions FROM properties WHERE id = ?').get('p3');
    expect(propsAfter.instructions).toBe(propsBefore.instructions);
    expect(propsAfter.instructions).toBe('MAESTRO');
  });
});

describe('issues #40 y #210 — borrado de limpiezas (cualquier estado)', () => {
  it('el borrado elimina la limpieza sin tocar otras ni la reserva origen', () => {
    insertProperty('p-del', { checklist: ['A'], instructions: 'x' });
    db.prepare(`INSERT INTO reservations (id, property_id, uid, checkin, checkout, summary, created_at)
                VALUES ('r-origen','p-del','uid-del','2026-08-01','2026-08-05','R',0)`).run();
    insertCleaning('c-del', 'p-del', { checks: '[]', instructions: null });
    db.prepare('UPDATE cleanings SET reservation_id = ? WHERE id = ?').run('r-origen', 'c-del');
    insertCleaning('c-keep', 'p-del');

    db.prepare('DELETE FROM cleanings WHERE id = ?').run('c-del');

    expect(db.prepare('SELECT COUNT(*) n FROM cleanings WHERE id = ?').get('c-del').n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM cleanings WHERE id = ?').get('c-keep').n).toBe(1);
    // la reserva de origen sigue intacta
    expect(db.prepare('SELECT COUNT(*) n FROM reservations WHERE id = ?').get('r-origen').n).toBe(1);
  });

  it('una limpieza archivada con horas, productos y fotos también se puede borrar', () => {
    insertProperty('p-del2', { checklist: ['A'], instructions: 'x' });
    db.prepare(`INSERT INTO people (id, name, hourly_rate, created_at) VALUES ('pers-del','P',12,0)`).run();
    insertCleaning('c-arch', 'p-del2', { status: 'archivada', checks: '[]' });
    db.prepare(`UPDATE cleanings SET work_log = ?, supplies = ?, photos = ? WHERE id = 'c-arch'`).run(
      JSON.stringify([{ personId: 'pers-del', hours: 2 }]),
      JSON.stringify([{ label: 'lejía', amount: 3 }]),
      JSON.stringify(['/photos/x.webp']),
    );

    db.prepare('DELETE FROM cleanings WHERE id = ?').run('c-arch');
    expect(db.prepare('SELECT COUNT(*) n FROM cleanings WHERE id = ?').get('c-arch').n).toBe(0);
  });
});
