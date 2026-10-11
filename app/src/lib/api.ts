/** Fetch con credenciales (cookie de sesión) y manejo de 401:
 *  1) intento de restauración con el token persistente (#290): re-crea la
 *     sesión cookie aunque el navegador la haya purgado y reintenta la
 *     petición original;
 *  2) si no hay restauración posible → evento global hacia /login. */
export async function api<T = unknown>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  // Login/logout/restore son endpoints de autenticación gestionados por el
  // llamador: un 401 en ellos es credenciales rechazadas o sesión ya
  // inexistente, no una sesión caída. Se deja que el error fluya al llamador.
  const isAuthEndpoint =
    path === '/api/auth/login' || path === '/api/auth/logout' || path === '/api/auth/restore';
  if (res.status === 401 && !isAuthEndpoint) {
    if (isRetry || !(await tryRestore())) {
      window.dispatchEvent(new Event('keynest-unauthorized'));
      throw new Error('no autorizado');
    }
    // Sesión restaurada: reintentamos la petición original una sola vez
    return api<T>(path, init, true);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data;
}

/** Import dinámico para no crear ciclo de imports api→auth→api. */
async function tryRestore(): Promise<boolean> {
  const { tryRestoreSession } = await import('./auth');
  return tryRestoreSession();
}
