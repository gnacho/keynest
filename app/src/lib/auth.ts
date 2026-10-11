import { api } from './api';

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  language: 'auto' | 'es' | 'en';
  role: string;
  display_name?: string;
  avatar?: string;
  is_demo?: boolean;
}

const USER_KEY = 'keynest-user';
const RESTORE_KEY = 'keynest-restore';

export function cachedUser(): SessionUser | null {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

/** Token de re-autenticación persistente (#290): permite re-crear la sesión
 *  cookie cuando el navegador la purga (algunos navegadores móviles la tratan
 *  como de sesión aunque el server emita maxAge 30d). */
export function getRestoreToken(): string | null {
  try {
    return window.localStorage.getItem(RESTORE_KEY);
  } catch {
    return null;
  }
}

function storeRestoreToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(RESTORE_KEY, token);
    else window.localStorage.removeItem(RESTORE_KEY);
  } catch {
    /* noop */
  }
}

function storeUser(u: SessionUser | null): void {
  try {
    if (u) window.localStorage.setItem(USER_KEY, JSON.stringify(u));
    else window.localStorage.removeItem(USER_KEY);
  } catch {
    /* noop */
  }
}

export function isAuthed(): boolean {
  return cachedUser() !== null;
}

/** Ids de las propiedades cuyo ownerId coincide con el usuario actual. */
export function myPropertyIds(properties: { id: string; ownerId?: string | null }[]): Set<string> {
  const me = cachedUser();
  if (!me) return new Set();
  return new Set(properties.filter((p) => p.ownerId === me.id).map((p) => p.id));
}

export async function login(username: string, password: string, remember = true): Promise<SessionUser> {
  const res = await api<{ user: SessionUser; restoreToken?: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, remember }),
  });
  storeUser(res.user);
  if (res.restoreToken) storeRestoreToken(res.restoreToken);
  return res.user;
}

export async function logout(): Promise<void> {
  const token = getRestoreToken();
  await api('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
  storeUser(null);
  storeRestoreToken(null);
  // Mismo evento que un 401: Root escucha 'keynest-unauthorized' y vuelve a /login
  window.dispatchEvent(new Event('keynest-unauthorized'));
}

/** Re-crea la sesión cookie a partir del token persistente y lo rota.
 *  Devuelve false si no hay token o el server lo rechaza (se borra). */
export async function restoreSession(): Promise<boolean> {
  const token = getRestoreToken();
  if (!token) return false;
  try {
    const res = await fetch('/api/auth/restore', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      storeRestoreToken(null);
      return false;
    }
    const data = (await res.json()) as { user: SessionUser; restoreToken: string };
    storeUser(data.user);
    storeRestoreToken(data.restoreToken);
    return true;
  } catch {
    return false;
  }
}

/** En curso: evita restauraciones concurrentes desde varios 401 a la vez. */
let restoring: Promise<boolean> | null = null;

export function tryRestoreSession(): Promise<boolean> {
  if (!restoring) {
    restoring = restoreSession().finally(() => {
      restoring = null;
    });
  }
  return restoring;
}

export async function demoLogin(): Promise<SessionUser> {
  const res = await api<{ user: SessionUser }>('/api/auth/demo', { method: 'POST' });
  storeUser(res.user);
  return res.user;
}

export async function demoStatus(): Promise<boolean> {
  try {
    const res = await api<{ enabled: boolean }>('/api/auth/demo-status');
    return res.enabled;
  } catch {
    return false;
  }
}

export async function setDemoMode(enabled: boolean): Promise<void> {
  await api('/api/config/demo', { method: 'PUT', body: JSON.stringify({ enabled }) });
}

export async function fetchMe(): Promise<SessionUser | null> {
  try {
    const res = await api<{ user: SessionUser }>('/api/auth/me');
    storeUser(res.user);
    return res.user;
  } catch {
    storeUser(null);
    return null;
  }
}

export async function saveLanguage(language: 'auto' | 'es' | 'en'): Promise<SessionUser> {
  const res = await api<{ user: SessionUser }>('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify({ language }),
  });
  storeUser(res.user);
  return res.user;
}

export function clearSession(): void {
  storeUser(null);
}
