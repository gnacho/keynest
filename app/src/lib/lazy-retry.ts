// lazy-retry.ts — React.lazy tolerante a despliegues (anti pantalla negra).
// Ver webapp-shell references/actualizaciones.md. Si un chunk viejo da 404
// tras un despliegue, recarga la página UNA vez por sesión (flag sessionStorage);
// si tras la recarga sigue fallando, el error sube al ErrorBoundary.
import { lazy } from 'react';
import type { ComponentType } from 'react';

const RELOAD_FLAG = 'keynest-chunk-reload';

export function lazyRetry<T extends ComponentType<Record<string, never>>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const m = await factory();
      sessionStorage.removeItem(RELOAD_FLAG);
      return m;
    } catch (err) {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
