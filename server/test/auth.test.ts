import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { openDb } from '../src/db.js';
import type { DB } from '../src/db.js';
import type { Context } from 'hono';
import type { AppEnv } from '../src/auth.js';
import {
  changePassword,
  countAdmins,
  createRestoreToken,
  createUser,
  destroyRestoreToken,
  deleteUser,
  destroyOtherSessions,
  ensureBootstrapAdmin,
  renewSessionIfDue,
  restoreFromToken,
  setUserPassword,
  setUserRole,
} from '../src/auth.js';

let dir: string;
let db: DB;

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
    expect((db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n).toBe(1);
  });

  it('createUser exige usuario único y hashea la contraseña', async () => {
    const u = await createUser(db, { username: 'laura', password: 'clave99', role: 'user' });
    expect(u!.username).toBe('laura');
    expect((u as any).password_hash).toBeUndefined(); // no se devuelve el hash en el SELECT público
    const dup = await createUser(db, { username: 'laura', password: 'clave99' });
    expect(dup).toBeNull();
  });

  it('changePassword: rechaza actual incorrecta y acepta la nueva', async () => {
    expect(await changePassword(db, 'nope', 'x', 'y')).toBe('error');
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get('admin') as { id: string };
    expect(await changePassword(db, u.id, 'malapass', 'nueva123')).toBe('wrong-current');
    expect(await changePassword(db, u.id, 'secreto123', 'nueva123')).toBe('ok');
    expect(await changePassword(db, u.id, 'nueva123', 'secreto123')).toBe('ok'); // restaurar
  });
});

describe('gestión de usuarios (admin)', () => {
  it('createUser respeta el rol indicado (user por defecto)', async () => {
    const user = await createUser(db, { username: 'pepe-user', password: 'clave99' });
    expect(user!.role).toBe('user');
    const admin = await createUser(db, { username: 'ana-admin', password: 'clave99', role: 'admin' });
    expect(admin!.role).toBe('admin');
    expect(countAdmins(db)).toBe(2); // bootstrap + ana-admin
  });

  it('setUserRole cambia el rol y setUserPassword destruye sesiones', async () => {
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get('pepe-user') as { id: string };
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo) VALUES (?, ?, ?, ?, ?, 0)')
      .run('sess-test', u.id, Date.now(), Date.now() + 60000, 'test');
    const updated = setUserRole(db, u.id, 'admin');
    expect(updated.role).toBe('admin');
    expect(await setUserPassword(db, u.id, 'otra-clave-99')).toBe(true);
    expect((db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(u.id) as { n: number }).n).toBe(0);
    expect(await setUserPassword(db, 'no-existe', 'x12345')).toBe(false);
    setUserRole(db, u.id, 'user'); // restaurar
  });

  it('deleteUser borra usuario y sus sesiones', async () => {
    const u = await createUser(db, { username: 'borrable', password: 'clave99' });
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo) VALUES (?, ?, ?, ?, ?, 0)')
      .run('sess-borrable', u!.id, Date.now(), Date.now() + 60000, 'test');
    expect(deleteUser(db, u!.id)).toBe(true);
    expect((db.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(u!.id) as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(u!.id) as { n: number }).n).toBe(0);
    expect(deleteUser(db, 'no-existe')).toBe(false);
  });

  it('destroyOtherSessions borra todas salvo la actual (cambio de contraseña)', async () => {
    const u = await createUser(db, { username: 'multi-sesion', password: 'clave99' });
    for (const id of ['sess-a', 'sess-b', 'sess-c']) {
      db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo) VALUES (?, ?, ?, ?, ?, 0)')
        .run(id, u!.id, Date.now(), Date.now() + 60000, 'test');
    }
    destroyOtherSessions(db, u!.id, 'sess-b');
    const restantes = (db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(u!.id) as Array<{ id: string }>).map((r) => r.id);
    expect(restantes).toEqual(['sess-b']);
    deleteUser(db, u!.id); // limpieza
  });
});

describe('expiración deslizante de sesiones (#267)', () => {
  const insertSession = (id: string, userId: string, expiresAt: number, remember: boolean) =>
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, is_demo, remember) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .run(id, userId, Date.now(), expiresAt, 'test', remember ? 1 : 0);

  it('la migración 23 añade la columna remember a sessions', () => {
    const cols = (db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('remember');
  });

  it('sesión persistente por debajo del umbral: renueva expires_at', async () => {
    const u = await createUser(db, { username: 'slide-user', password: 'clave99' });
    const soon = Date.now() + 10 * 24 * 3600 * 1000; // 10 días < umbral (15 días)
    insertSession('sess-slide', u!.id, soon, true);
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-slide') as any;
    expect(renewSessionIfDue(db, s)).toBe(true);
    const after = (db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get('sess-slide') as { expires_at: number }).expires_at;
    expect(after).toBeGreaterThan(Date.now() + 25 * 24 * 3600 * 1000);
    deleteUser(db, u!.id);
  });

  it('sesión persistente por encima del umbral: no toca nada', async () => {
    const u = await createUser(db, { username: 'fresh-user', password: 'clave99' });
    const fresh = Date.now() + 20 * 24 * 3600 * 1000; // 20 días > umbral (15 días)
    insertSession('sess-fresh', u!.id, fresh, true);
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-fresh') as any;
    expect(renewSessionIfDue(db, s)).toBe(false);
    expect((db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get('sess-fresh') as { expires_at: number }).expires_at).toBe(fresh);
    deleteUser(db, u!.id);
  });

  it('sesión no persistente (sin recuérdame): nunca renueva', async () => {
    const u = await createUser(db, { username: 'nopersist-user', password: 'clave99' });
    const soon = Date.now() + 60 * 1000;
    insertSession('sess-nopersist', u!.id, soon, false);
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-nopersist') as any;
    expect(renewSessionIfDue(db, s)).toBe(false);
    expect((db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get('sess-nopersist') as { expires_at: number }).expires_at).toBe(soon);
    deleteUser(db, u!.id);
  });
});

describe('re-autenticación persistente (#290)', () => {
  const ctx = (): Context<AppEnv> => ({ req: { header: () => 'test-ua' }, header: () => {} } as unknown as Context<AppEnv>);
  const lauraId = () => (db.prepare("SELECT id FROM users WHERE username = 'laura'").get() as { id: string }).id;

  it('la migración 25 crea login_tokens', () => {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name);
    expect(tables).toContain('login_tokens');
  });

  it('crea token, restaura sesión y rota (el viejo no se reutiliza)', () => {
    const before = (db.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n;
    const token = createRestoreToken(db, lauraId());
    expect(token).toBeTruthy();

    const restored = restoreFromToken(db, ctx(), token);
    expect(restored!.user.username).toBe('laura');
    expect(restored!.newToken).not.toBe(token);
    expect((db.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n).toBe(before + 1);
    expect((db.prepare('SELECT remember FROM sessions ORDER BY created_at DESC LIMIT 1').get() as { remember: number }).remember).toBe(1);

    expect(restoreFromToken(db, ctx(), token)).toBeNull();
    expect(restoreFromToken(db, ctx(), restored!.newToken)?.user.username).toBe('laura');
  });

  it('token inexistente, vacío o expirado → null', () => {
    expect(restoreFromToken(db, ctx(), 'token-que-no-existe')).toBeNull();
    expect(restoreFromToken(db, ctx(), '')).toBeNull();
    expect(restoreFromToken(db, ctx(), undefined)).toBeNull();

    const token = createRestoreToken(db, lauraId());
    const hash = createHash('sha256').update(token).digest('hex');
    db.prepare('UPDATE login_tokens SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1000, hash);
    expect(restoreFromToken(db, ctx(), token)).toBeNull();
  });

  it('logout invalida el token del dispositivo', () => {
    const token = createRestoreToken(db, lauraId());
    expect(restoreFromToken(db, ctx(), token)).not.toBeNull();
    const newToken = (db.prepare('SELECT token_hash FROM login_tokens ORDER BY created_at DESC LIMIT 1').get() as { token_hash: string }).token_hash;
    void newToken;
    destroyRestoreToken(db, token);
    expect(restoreFromToken(db, ctx(), token)).toBeNull();
  });

  it('máximo 5 tokens por usuario y purga de expirados', () => {
    for (let i = 0; i < 8; i++) createRestoreToken(db, lauraId());
    const n = (db.prepare('SELECT COUNT(*) n FROM login_tokens WHERE user_id = ?').get(lauraId()) as { n: number }).n;
    expect(n).toBeLessThanOrEqual(5);
  });
});
