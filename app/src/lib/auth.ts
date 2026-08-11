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

export function cachedUser(): SessionUser | null {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
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
  const res = await api<{ user: SessionUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, remember }),
  });
  storeUser(res.user);
  return res.user;
}

export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  storeUser(null);
  // Mismo evento que un 401: Root escucha 'keynest-unauthorized' y vuelve a /login
  window.dispatchEvent(new Event('keynest-unauthorized'));
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
