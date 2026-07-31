import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { changePassword, createUser, ensureBootstrapAdmin } from '../src/auth.js';

let dir;
let db;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-test-'));
  db = openDb(dir, 'test.db');
  await ensureBootstrapAdmin(db, { authUser: 'admin', authPass: 'secreto123' });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('auth (base común)', () => {
  it('bootstrap crea el admin solo una vez', async () => {
    await ensureBootstrapAdmin(db, { authUser: 'admin', authPass: 'secreto123' });
    expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(1);
  });

  it('createUser exige usuario único y hashea la contraseña', async () => {
    const u = await createUser(db, { username: 'laura', password: 'clave99', role: 'user' });
    expect(u.username).toBe('laura');
    expect(u.password_hash).toBeUndefined(); // no se devuelve el hash en el SELECT público
    const dup = await createUser(db, { username: 'laura', password: 'clave99' });
    expect(dup).toBeNull();
  });

  it('changePassword: rechaza actual incorrecta y acepta la nueva', async () => {
    expect(await changePassword(db, 'nope', 'x', 'y')).toBe('error');
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    expect(await changePassword(db, u.id, 'malapass', 'nueva123')).toBe('wrong-current');
    expect(await changePassword(db, u.id, 'secreto123', 'nueva123')).toBe('ok');
    expect(await changePassword(db, u.id, 'nueva123', 'secreto123')).toBe('ok'); // restaurar
  });
});
