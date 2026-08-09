/** Fetch con credenciales (cookie de sesión) y manejo de 401 → evento global. */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  // Login/logout son endpoints de autenticación gestionados por el llamador:
  // un 401 en ellos es credenciales rechazadas o sesión ya inexistente, no una
  // sesión caída. Se deja que el cuerpo del error fluya al llamador.
  const isAuthEndpoint = path === '/api/auth/login' || path === '/api/auth/logout';
  if (res.status === 401 && !isAuthEndpoint) {
    window.dispatchEvent(new Event('keynest-unauthorized'));
    throw new Error('no autorizado');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data;
}
