import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import {
  changePassword,
  countAdmins,
  createUser,
  deleteUser,
  destroyOtherSessions,
  ensureBootstrapAdmin,
  setUserPassword,
  setUserRole,
} from '../src/auth.js';

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

describe('gestión de usuarios (admin)', () => {
  it('createUser respeta el rol indicado (user por defecto)', async () => {
    const user = await createUser(db, { username: 'pepe-user', password: 'clave99' });
    expect(user.role).toBe('user');
    const admin = await createUser(db, { username: 'ana-admin', password: 'clave99', role: 'admin' });
    expect(admin.role).toBe('admin');
    expect(countAdmins(db)).toBe(2); // bootstrap + ana-admin
  });

  it('setUserRole cambia el rol y setUserPassword destruye sesiones', async () => {
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get('pepe-user');
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo) VALUES (?, ?, ?, ?, ?, 0)')
      .run('sess-test', u.id, Date.now(), Date.now() + 60000, 'test');
    const updated = setUserRole(db, u.id, 'admin');
    expect(updated.role).toBe('admin');
    expect(await setUserPassword(db, u.id, 'otra-clave-99')).toBe(true);
    expect(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(u.id).n).toBe(0);
    expect(await setUserPassword(db, 'no-existe', 'x12345')).toBe(false);
    setUserRole(db, u.id, 'user'); // restaurar
  });

  it('deleteUser borra usuario y sus sesiones', async () => {
    const u = await createUser(db, { username: 'borrable', password: 'clave99' });
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo) VALUES (?, ?, ?, ?, ?, 0)')
      .run('sess-borrable', u.id, Date.now(), Date.now() + 60000, 'test');
    expect(deleteUser(db, u.id)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(u.id).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(u.id).n).toBe(0);
    expect(deleteUser(db, 'no-existe')).toBe(false);
  });

  it('destroyOtherSessions borra todas salvo la actual (cambio de contraseña)', async () => {
    const u = await createUser(db, { username: 'multi-sesion', password: 'clave99' });
    for (const id of ['sess-a', 'sess-b', 'sess-c']) {
      db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo) VALUES (?, ?, ?, ?, ?, 0)')
        .run(id, u.id, Date.now(), Date.now() + 60000, 'test');
    }
    destroyOtherSessions(db, u.id, 'sess-b');
    const restantes = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(u.id).map((r) => r.id);
    expect(restantes).toEqual(['sess-b']);
    deleteUser(db, u.id); // limpieza
  });
});
