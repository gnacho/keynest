// NotificationsCard — tarjeta de Ajustes para las notificaciones push.
// Estados: requiere-https (LAN HTTP), iOS sin PWA, demo, sin VAPID, sin
// soporte, y ok (botón Activar/Desactivar + toggles por tipo de alerta).
// Patrón: skill web-push-alerts; mismo diseño que el resto de la shell.
import { useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from './settings-cards';
import { usePush } from '@/hooks/usePush';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const TIPOS_NOTIF = [
  'checkin_hoy',
  'checkout_hoy',
  'reserva_nueva',
  'tedee_offline',
  'tedee_ok',
  'tedee_bateria',
  'limpieza_pendiente',
] as const;

function Aviso({ children, tono = 'neutro' }: { children: React.ReactNode; tono?: 'neutro' | 'aviso' | 'peligro' }) {
  const estilos = {
    neutro: { borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' },
    aviso: { borderColor: 'rgb(245 158 11 / 0.3)', backgroundColor: 'rgb(245 158 11 / 0.08)', color: '#D97706' },
    peligro: { borderColor: 'rgb(244 63 94 / 0.3)', backgroundColor: 'rgb(244 63 94 / 0.08)', color: '#F43F5E' },
  } as const;
  return (
    <p className="rounded-xl border px-3.5 py-2.5 text-[13px] leading-snug" style={estilos[tono]}>
      {children}
    </p>
  );
}

export default function NotificationsCard() {
  const { t: tr } = useTranslation();
  const { soporte, estado, activar, desactivar } = usePush();
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    if (!estado.suscrito) {
      setPrefs(null);
      return;
    }
    api<{ prefs: Record<string, boolean> }>('/api/push/preferences')
      .then((r) => setPrefs(r.prefs))
      .catch(() => setPrefs(null));
  }, [estado.suscrito]);

  const cambiarPref = (tipo: string, enabled: boolean) => {
    setPrefs((p) => (p ? { ...p, [tipo]: enabled } : p));
    api('/api/push/preferences', { method: 'PUT', body: JSON.stringify({ tipo, enabled }) }).catch(() => {
      setPrefs((p) => (p ? { ...p, [tipo]: !enabled } : p)); // rollback optimista
    });
  };

  return (
    <Card title={tr('aj.notificaciones')} desc={tr('aj.notificacionesDesc')}>
      {estado.cargando ? (
        <div className="h-10 animate-pulse rounded-xl" style={{ backgroundColor: 'var(--surface-2)' }} />
      ) : soporte === 'requiere-https' ? (
        <Aviso tono="aviso">{tr('aj.notifRequiereHttps')}</Aviso>
      ) : soporte === 'ios-necesita-instalacion' ? (
        <Aviso>{tr('aj.notifIos')}</Aviso>
      ) : soporte === 'demo' ? (
        <Aviso>{tr('aj.notifDemo')}</Aviso>
      ) : soporte === 'no-configurado' ? (
        <Aviso>{tr('aj.notifNoConfigurado')}</Aviso>
      ) : soporte === 'no-soportado' ? (
        <Aviso>{tr('aj.notifNoSoportado')}</Aviso>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            {estado.suscrito ? (
              <button
                type="button"
                onClick={() => void desactivar()}
                disabled={estado.cargando}
                className="flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)] disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <Bell className="h-4 w-4" strokeWidth={1.75} style={{ color: 'var(--text-muted)' }} />
                {tr('aj.notifDesactivar')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void activar()}
                disabled={estado.cargando}
                className="flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150 disabled:opacity-50"
                style={{
                  borderColor: 'rgb(99 102 241 / 0.4)',
                  backgroundColor: 'rgb(99 102 241 / 0.1)',
                  color: '#6366F1',
                }}
              >
                <Bell className="h-4 w-4" strokeWidth={1.75} />
                {tr('aj.notifActivar')}
              </button>
            )}
            {estado.suscrito && (
              <span className="flex items-center gap-1.5 text-[13px]" style={{ color: '#059669' }}>
                <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                {tr('aj.notifActivadas')}
              </span>
            )}
          </div>
          {estado.permiso === 'denied' && <Aviso tono="peligro">{tr('aj.notifPermisoDenegado')}</Aviso>}
          {estado.error && <p className="text-[13px]" style={{ color: '#F43F5E' }}>{estado.error}</p>}

          {estado.suscrito && prefs && (
            <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.notifTipos')}
              </p>
              {TIPOS_NOTIF.map((tipo) => (
                <div key={tipo} className="flex items-center justify-between gap-3">
                  <span className="text-sm" style={{ color: 'var(--text)' }}>
                    {tr(`aj.notifTipo.${tipo}`)}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs[tipo] !== false}
                    aria-label={tr(`aj.notifTipo.${tipo}`)}
                    onClick={() => cambiarPref(tipo, prefs[tipo] === false)}
                    className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150')}
                    style={{ backgroundColor: prefs[tipo] !== false ? '#6366F1' : 'var(--surface-2)' }}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                        prefs[tipo] !== false ? 'translate-x-[22px]' : 'translate-x-0.5',
                      )}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
