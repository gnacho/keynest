import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useData } from '@/data/useData';
import { fmtRelative } from '@/lib/format';

const DOT: Record<string, string> = {
  orange: '#F97316',
  rose: '#F43F5E',
  blue: '#3B82F6',
  emerald: '#10B981',
  slate: '#64748B',
  violet: '#8B5CF6',
  indigo: '#6366F1',
};

/** Campana de alertas persistente en el header (todas las vistas). */
export default function NotificationsPopover() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const data = useData();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const notifications = data.getNotifications().filter((n) => !dismissed.has(n.id));

  const clearAll = () => {
    setDismissed((prev) => new Set([...prev, ...notifications.map((n) => n.id)]));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('dash.notificaciones')}
          className="relative flex h-9 w-9 items-center justify-center rounded-xl border transition-colors hover:bg-[var(--surface-2)]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          <Bell className="h-[18px] w-[18px]" />
          {notifications.length > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl border-[var(--border)] bg-[var(--surface)] p-2 shadow-overlay">
        <div className="flex items-center justify-between px-2 py-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
            {t('dash.notificaciones')}
          </p>
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="flex items-center gap-1 text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ color: 'var(--text-muted)' }}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t('dash.limpiarAlertas')}
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className="px-2 py-3 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {t('dash.sinAlertas')}
          </p>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => navigate(n.to)}
              className="flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
            >
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: DOT[n.tone] ?? '#64748B' }} />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-5">{n.text}</span>
                <span className="block text-xs" style={{ color: 'var(--text-faint)' }}>
                  {fmtRelative(n.time)}
                </span>
              </span>
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
