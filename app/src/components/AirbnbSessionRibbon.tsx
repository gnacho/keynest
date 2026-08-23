import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, TriangleAlert, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cachedUser } from '@/lib/auth';
import AirbnbRenewDialog from '@/components/AirbnbRenewDialog';

const DISMISS_KEY = 'keynest-airbnb-sesion-dismiss';
const REAPPEAR_MS = 24 * 60 * 60 * 1000;

interface AirbnbStatus {
  sesion: { viva?: boolean; ultimo_check?: string | null; extraccion_ok?: boolean; detalle?: string | null };
  estadoGuardado: Record<string, unknown>;
}

/** Ribbon ROJO si la sesión del scraper Airbnb está muerta. Visible para TODOS
 *  los usuarios (no solo admin). Descartable con X; reaparece a las 24h. */
export default function AirbnbSessionRibbon() {
  const { t } = useTranslation();
  const [muerta, setMuerta] = useState(false);
  const [detalle, setDetalle] = useState('');
  const [renewOpen, setRenewOpen] = useState(false);
  const isAdmin = cachedUser()?.role === 'admin';

  useEffect(() => {
    let stale = false;
    const run = async () => {
      try {
        const s = await api<AirbnbStatus>('/api/airbnb/status');
        if (stale) return;
        if (s.sesion?.viva !== false) {
          setMuerta(false);
          return;
        }
        const last = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
        if (Date.now() - last < REAPPEAR_MS) return;
        setMuerta(true);
        setDetalle(s.sesion?.detalle ?? '');
      } catch {
        /* sin red o sesión expirada: no molestar */
      }
    };
    void run();
    return () => {
      stale = true;
    };
  }, []);

  if (!muerta) return null;

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setMuerta(false);
  };

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold"
      style={{ borderColor: 'rgb(244 63 94 / 0.4)', backgroundColor: 'rgb(244 63 94 / 0.1)', color: '#E11D48' }}
    >
      <TriangleAlert className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{t('airbnb.sesionCaida')}{detalle ? ` · ${detalle}` : ''}</span>
      {isAdmin && (
        <button
          type="button"
          onClick={() => setRenewOpen(true)}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
          style={{ borderColor: 'rgb(244 63 94 / 0.3)' }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('airbnb.renovar')}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('airbnb.descartar')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--surface-2)]"
        style={{ borderColor: 'rgb(244 63 94 / 0.3)' }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <AirbnbRenewDialog open={renewOpen} onOpenChange={setRenewOpen} />
    </div>
  );
}
