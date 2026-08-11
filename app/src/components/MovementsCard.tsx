import { Link } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { LogIn, LogOut, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Row {
  to: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  value: number;
  label: string;
  ariaLabel: string;
  kind: 'in' | 'out' | 'cleaning';
}

interface MovementsCardProps {
  checkIns: number;
  checkOuts: number;
  cleanings: number;
  unassigned: number;
  /** Entradas que coinciden con una salida el mismo día (rotación). */
  sameDayCheckIns: number;
  lookaheadDays: number;
  className?: string;
}

/** Tarjeta unificada de movimientos (entradas · salidas · limpiezas): número y etiqueta en mayúsculas, compacta, con leyenda del plazo. */
export default function MovementsCard({ checkIns, checkOuts, cleanings, unassigned, sameDayCheckIns, lookaheadDays, className }: MovementsCardProps) {
  const { t } = useTranslation();

  const rows: Row[] = [
    {
      to: '/reservas',
      icon: LogIn,
      color: '#10B981',
      bg: 'var(--em-chip-bg)',
      value: checkIns,
      label: t('dash.entradas'),
      ariaLabel: t('dash.entradas'),
      kind: 'in',
    },
    {
      to: '/reservas',
      icon: LogOut,
      color: '#F97316',
      bg: 'var(--or-chip-bg)',
      value: checkOuts,
      label: t('dash.salidas'),
      ariaLabel: t('dash.salidas'),
      kind: 'out',
    },
    {
      to: '/limpieza',
      icon: Sparkles,
      color: '#8B5CF6',
      bg: 'var(--vi-chip-bg)',
      value: cleanings,
      label: t('dash.limpiezas'),
      ariaLabel: t('dash.limpiezas'),
      kind: 'cleaning',
    },
  ];

  return (
    <div className={`card flex h-full flex-col justify-between gap-1 p-1.5 ${className ?? ''}`}>
      <p
        className="text-[9px] font-semibold uppercase leading-3 tracking-[0.08em]"
        style={{ color: 'var(--text-faint)' }}
      >
        {t('dash.proximosDias', { days: lookaheadDays })}
      </p>
      <div className="flex flex-col">
        {rows.map(({ to, icon: Icon, color, bg, value, label, ariaLabel, kind }) => (
          <Link
            key={to + label}
            to={to}
            aria-label={ariaLabel}
            className="flex items-center gap-2 rounded-lg px-1 py-1 transition-colors duration-150 hover:bg-[var(--surface-2)]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: bg }}>
              <Icon className="h-3.5 w-3.5" style={{ color }} strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="font-display tnum text-[17px] font-semibold leading-5" style={{ color: 'var(--text)' }}>
                {value}
              </span>
              <span className="font-display text-[14px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {label}
              </span>
            </span>
            {kind === 'cleaning' && unassigned > 0 && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                style={{ backgroundColor: 'var(--ro-chip-bg)', color: '#F43F5E' }}
              >
                {t('dash.porAsignar', { count: unassigned })}
              </span>
            )}
            {kind === 'cleaning' && unassigned === 0 && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                style={{ backgroundColor: 'var(--em-chip-bg)', color: '#10B981' }}
              >
                {t('dash.sinAsignar', { count: 0 })}
              </span>
            )}
            {kind === 'in' && sameDayCheckIns > 0 && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                style={{ backgroundColor: 'var(--or-chip-bg)', color: '#F97316' }}
              >
                {t('dash.mismoDia', { count: sameDayCheckIns })}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
