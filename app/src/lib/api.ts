/** Fetch con credenciales (cookie de sesión) y manejo de 401 → evento global. */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  // El login gestiona su propio 401 (credencial rechazada): hay que leer el body
  // y propagar el error real del servidor (p. ej. rate-limit 429 con su mensaje).
  // No dispatchar 'keynest-unauthorized', que indica sesión expirada en rutas
  // autenticadas, no un credencial malo en la pantalla de login.
  if (res.status === 401 && path !== '/api/auth/login') {
    window.dispatchEvent(new Event('keynest-unauthorized'));
    throw new Error('no autorizado');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data;
}
