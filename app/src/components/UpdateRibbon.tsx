import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { applyRelease } from '@/lib/apply-update';

const CHECK_KEY = 'keynest-last-update-check';
const CHECK_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 1 vez por semana (regla app-auto-update)

interface UpdateStatus {
  current: string;
  latest: string | null;
  available: boolean;
}

/**
 * Ribbon de actualización (patrón app-auto-update: check semanal + aviso si hay
 * versión nueva). Solo admin (el endpoint es requireAdmin). El apply es async
 * (flag + systemd .path): applyRelease() sondea /api/version hasta que el build
 * cambia o timeout.
 */
export default function UpdateRibbon() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateStatus | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let stale = false;
    const run = async () => {
      try {
        const last = Number(window.localStorage.getItem(CHECK_KEY) || 0);
        if (Date.now() - last < CHECK_INTERVAL) return; // ya se comprobó esta semana
        window.localStorage.setItem(CHECK_KEY, String(Date.now()));
        const s = await api<UpdateStatus>('/api/update/status');
        if (!stale) setInfo(s);
      } catch {
        /* sin info de update: no molestar */
      }
    };
    void run();
    return () => {
      stale = true;
    };
  }, []);

  if (!info?.available) return null;

  const apply = async () => {
    if (applying) return;
    setApplying(true);
    try {
      const done = await applyRelease();
      toast.success(done ? t('aj.actualizadoOk') : t('aj.actualizandoTarda'));
      setInfo((s) => (s ? { ...s, available: false } : s));
    } catch {
      toast.error(t('aj.errorActualizar'));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold"
      style={{
        borderColor: 'rgb(245 158 11 / 0.35)',
        backgroundColor: 'rgb(245 158 11 / 0.1)',
        color: '#F59E0B',
      }}
    >
      <RefreshCw className="h-4 w-4 shrink-0" />
      <span>{t('aj.nuevaVersion')}{info.latest ? ` — v${info.latest}` : ''}</span>
      <button
        type="button"
        onClick={() => void apply()}
        disabled={applying}
        className="ml-auto flex h-8 shrink-0 items-center rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-50"
        style={{ borderColor: 'rgb(245 158 11 / 0.4)', color: '#F59E0B' }}
      >
        <RefreshCw className={applying ? 'mr-1.5 h-3.5 w-3.5 animate-spin' : 'mr-1.5 h-3.5 w-3.5'} />
        {applying ? t('aj.actualizando') : t('aj.actualizarAhora')}
      </button>
    </div>
  );
}
