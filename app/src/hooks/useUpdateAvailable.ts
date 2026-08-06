// update-check.ts — aviso proactivo de versión nueva (anti pantalla negra).
// Ver webapp-shell references/actualizaciones.md. Sondea la versión del PROPIO
// servidor (no GitHub) y avisa cuando cambia tras un despliegue.
import { useEffect, useState } from 'react';

const POLL_MS = 10 * 60 * 1000;

let initialSig: string | null = null;

async function getServerVersion(): Promise<string> {
  const res = await fetch('/api/version', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { version: string; build?: string };
  return `${j.version}+${j.build ?? ''}`;
}

// enabled = sesión real iniciada (desactivar en modo demo).
export function useUpdateAvailable(enabled: boolean): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!enabled || available) return;
    const check = async () => {
      try {
        const sig = await getServerVersion();
        if (initialSig === null) initialSig = sig;
        else if (initialSig !== sig) setAvailable(true);
      } catch {
        /* sin red o sesión caducada: se reintenta en el próximo tick */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    void check();
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, available]);

  return available;
}
