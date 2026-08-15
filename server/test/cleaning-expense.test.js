import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, syncCleaningExpense, removeCleaningExpense, cleaningCostOf } from '../src/db.js';

let dir;
let db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-cleaning-exp-'));
  db = openDb(dir);
  db.prepare(
    `INSERT INTO properties (id, slug, name, checklist, instructions, created_at)
     VALUES ('p1', 'p1', 'Prop', '[]', '', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO people (id, name, role, hourly_rate, created_at)
     VALUES ('person-a', 'Ana', 'limpieza', 15, 0)`,
  ).run();
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function insertCleaning(id, { workLog = '[]', supplies = '[]', materials = 0, date = '2026-08-10' } = {}) {
  db.prepare(
    `INSERT INTO cleanings (id, property_id, date, status, assignee_ids, estimated_hours, checks, instructions, photos, work_log, supplies, materials, created_at)
     VALUES (?, 'p1', ?, 'archivada', '[]', 2, '[]', '', '[]', ?, ?, ?, 0)`,
  ).run(id, date, workLog, supplies, materials);
}

describe('issue #209 — gasto automático de limpieza vinculado', () => {
  it('la migración 22 añade source_cleaning_id a expenses', () => {
    const cols = db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name);
    expect(cols).toContain('source_cleaning_id');
  });

  it('cleaningCostOf = horas×€/h + materiales', () => {
    const cl = { work_log: JSON.stringify([{ personId: 'person-a', hours: 2 }]), materials: 10 };
    expect(cleaningCostOf(db, cl)).toBe(40);
    expect(cleaningCostOf(db, { work_log: '[]', materials: 5 })).toBe(5);
    expect(cleaningCostOf(db, { work_log: '[]', materials: 0 })).toBe(0);
  });

  it('sync crea el gasto vinculado con type limpieza, label Limpieza, coste real y mes/año de la fecha', () => {
    insertCleaning('c1', { workLog: JSON.stringify([{ personId: 'person-a', hours: 2 }]), materials: 10, date: '2026-08-10' });
    const id = syncCleaningExpense(db, db.prepare('SELECT * FROM cleanings WHERE id = ?').get('c1'));
    expect(id).toBeTruthy();
    const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    expect(exp).toMatchObject({
      property_id: 'p1',
      type: 'limpieza',
      label: 'Limpieza',
      amount: 40,
      month: 7, // 0-indexed (agosto)
      year: 2026,
      source_cleaning_id: 'c1',
    });
  });

  it('sync recalcula el gasto al cambiar horas/materiales', () => {
    db.prepare("UPDATE cleanings SET work_log = ?, supplies = ?, materials = ? WHERE id = ?")
      .run(JSON.stringify([{ personId: 'person-a', hours: 1 }]), '[]', 5, 'c1');
    const id = syncCleaningExpense(db, db.prepare('SELECT * FROM cleanings WHERE id = ?').get('c1'));
    const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    expect(exp.amount).toBe(20); // 1h×15 + 5
    const count = db.prepare('SELECT COUNT(*) n FROM expenses WHERE source_cleaning_id = ?').get('c1').n;
    expect(count).toBe(1); // no duplica
  });

  it('sync con coste 0 NO crea gasto (y borra el vinculado si existía)', () => {
    insertCleaning('c0', { workLog: '[]', materials: 0 });
    const id = syncCleaningExpense(db, db.prepare('SELECT * FROM cleanings WHERE id = ?').get('c0'));
    expect(id).toBeNull();
    expect(db.prepare('SELECT COUNT(*) n FROM expenses WHERE source_cleaning_id = ?').get('c0').n).toBe(0);
  });

  it('removeCleaningExpense borra el gasto vinculado', () => {
    insertCleaning('c2', { workLog: JSON.stringify([{ personId: 'person-a', hours: 1 }]), materials: 0, date: '2026-09-01' });
    const id = syncCleaningExpense(db, db.prepare('SELECT * FROM cleanings WHERE id = ?').get('c2'));
    expect(db.prepare('SELECT COUNT(*) n FROM expenses WHERE source_cleaning_id = ?').get('c2').n).toBe(1);
    removeCleaningExpense(db, 'c2');
    expect(db.prepare('SELECT COUNT(*) n FROM expenses WHERE source_cleaning_id = ?').get('c2').n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM expenses WHERE id = ?').get(id).n).toBe(0);
  });
});
