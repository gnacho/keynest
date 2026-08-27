// update.test.js — progreso del apply (#232): fresco vs stale, y notas del
// release cacheadas en kv (updateStatus las devuelve para la UI).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { updateProgress, updateStatus } from '../src/update.js';

let dir;
let db;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-update-test-'));
  db = openDb(dir, 'test.db');
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('updateProgress (#232)', () => {
  it('devuelve step/pct si el fichero es fresco', () => {
    writeFileSync(
      join(dir, 'update-progress.json'),
      JSON.stringify({ step: 'download', pct: 25, ts: Date.now() })
    );
    expect(updateProgress(dir)).toMatchObject({ step: 'download', pct: 25 });
  });

  it('un fichero stale (corrida muerta) no se reporta', () => {
    writeFileSync(
      join(dir, 'update-progress.json'),
      JSON.stringify({ step: 'download', pct: 25, ts: Date.now() - 20 * 60 * 1000 })
    );
    expect(updateProgress(dir)).toBeNull();
  });

  it('sin fichero devuelve null', () => {
    rmSync(join(dir, 'update-progress.json'), { force: true });
    expect(updateProgress(dir)).toBeNull();
  });
});

describe('updateStatus notes (#232)', () => {
  it('devuelve las notas del release desde la caché kv', async () => {
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('gh_latest_release', JSON.stringify({ at: Date.now(), id: '9.9.9', body: '- Nota de prueba' }));
    const st = await updateStatus(db, dir);
    expect(st.latest).toBe('9.9.9');
    expect(st.notes).toBe('- Nota de prueba');
  });
});
