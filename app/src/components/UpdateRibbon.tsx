import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { api } from '@/lib/api';
import { CHECK_INTERVAL, CHECK_KEY, onRibbonSignal } from '@/lib/update-check';
import UpdateDialog from './UpdateDialog';

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
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const check = async () => {
    try {
      const s = await api<UpdateStatus & { checkFailed?: boolean }>('/api/update/status');
      setInfo(s);
      setFailed(Boolean(s?.checkFailed));
    } catch {
      // Sin poder comprobar (red, server): visible en vez de silencio (#231).
      setFailed(true);
    }
  };

  useEffect(() => {
    let stale = false;
    const run = async () => {
      try {
        const last = Number(window.localStorage.getItem(CHECK_KEY) || 0);
        if (Date.now() - last < CHECK_INTERVAL) return; // ya se comprobó esta semana
        window.localStorage.setItem(CHECK_KEY, String(Date.now()));
        if (!stale) await check();
      } catch {
        /* sin storage */
      }
    };
    void run();
    const off = onRibbonSignal(() => {
      if (!stale) void check();
    });
    return () => {
      stale = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (dismissed) return null;

  // Aviso tranquilo de check fallido (#231): el server no pudo consultar GitHub
  // (p. ej. 403 rate-limit 60/h por IP). Reintentar a mano; semanal por defecto.
  if (!info?.available && failed) {
    return (
      <div
        role="alert"
        className="mb-4 flex items-center gap-2.5 rounded-xl border border-slate-300/60 bg-slate-100/80 px-3.5 py-2 text-[12px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t('update.checkFailed')}</span>
        <button
          type="button"
          onClick={() => void check()}
          className="ml-auto shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-slate-200/60 dark:border-slate-600 dark:hover:bg-slate-700/60"
        >
          {t('update.retry')}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t('update.dialog.close')}
          className="shrink-0 rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  if (!info?.available) return null;


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
      <span>{t('aj.nuevaVersion')}{info.latest ? ` - v${info.latest}` : ''}</span>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="ml-auto flex h-8 shrink-0 items-center rounded-lg border px-3 text-xs font-medium transition-colors"
        style={{ borderColor: 'rgb(245 158 11 / 0.4)', color: '#F59E0B' }}
      >
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        {t('aj.actualizarAhora')}
      </button>
      <UpdateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
