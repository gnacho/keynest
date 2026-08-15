import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';

let dir;
let db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-expenses-'));
  db = openDb(dir);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function insertProperty(id) {
  db.prepare(
    `INSERT INTO properties (id, slug, name, checklist, instructions, created_at)
     VALUES (?, ?, ?, '[]', '', 0)`,
  ).run(id, id, id);
}

function insertExpense(id, propertyId, over = {}) {
  db.prepare(
    `INSERT INTO expenses (id, property_id, type, label, amount, month, year, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    id,
    propertyId,
    over.type ?? 'internet',
    over.label ?? 'Internet fibra',
    over.amount ?? 39.99,
    over.month ?? 6,
    over.year ?? 2026,
  );
}

describe('issue #207 — gastos persistidos en BD', () => {
  it('la migración 21 crea la tabla expenses', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    expect(tables).toContain('expenses');
    const cols = db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'property_id', 'type', 'label', 'amount', 'month', 'year', 'created_at']),
    );
  });

  it('una BD que ya está en schema_version 20 (hueco nº20) aplica la 21 y crea expenses', () => {
    // Simula el CT 226: el motor ve current=20 (registrada por otra sesión) y
    // NO ejecuta la migración 20 (SELECT 1); debe ejecutar la 21 = expenses.
    const dir2 = mkdtempSync(join(tmpdir(), 'keynest-exp21-'));
    let db2 = openDb(dir2);
    // Degrada el estado: quita expenses y baja schema_version a 20 (con hueco 20)
    db2.exec('DROP TABLE expenses');
    db2.prepare('DELETE FROM schema_version WHERE version > 20').run();
    db2.prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (20, 0)').run();
    db2.close();
    // Reabrir: ahora current=20 → aplica solo la 21
    db2 = openDb(dir2);
    const hasExp = db2.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='expenses'").get().n;
    expect(hasExp).toBe(1);
    const maxV = db2.prepare('SELECT MAX(version) v FROM schema_version').get().v;
    expect(maxV).toBe(21);
    const versions = db2.prepare('SELECT version FROM schema_version ORDER BY version').all().map((r) => r.version);
    expect(versions).toContain(20);
    db2.close();
    rmSync(dir2, { recursive: true, force: true });
  });

  it('inserta un gasto y lo recupera con sus valores', () => {
    insertProperty('p1');
    insertExpense('e1', 'p1');
    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get('e1');
    expect(row).toMatchObject({
      id: 'e1',
      property_id: 'p1',
      type: 'internet',
      label: 'Internet fibra',
      amount: 39.99,
      month: 6,
      year: 2026,
    });
  });

  it('permite actualizar importe, tipo y mes', () => {
    insertExpense('e2', 'p1', { type: 'agua', label: 'Agua', amount: 24 });
    db.prepare('UPDATE expenses SET type = ?, label = ?, amount = ?, month = ?, year = ? WHERE id = ?')
      .run('luz', 'Electricidad', 62.5, 7, 2026, 'e2');
    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get('e2');
    expect(row).toMatchObject({ type: 'luz', label: 'Electricidad', amount: 62.5, month: 7, year: 2026 });
  });

  it('permite eliminar un gasto', () => {
    insertExpense('e3', 'p1');
    db.prepare('DELETE FROM expenses WHERE id = ?').run('e3');
    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get('e3');
    expect(row).toBeUndefined();
  });
});
