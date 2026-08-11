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
}

interface MovementsCardProps {
  checkIns: number;
  checkOuts: number;
  cleanings: number;
  unassigned: number;
  lookaheadDays: number;
  className?: string;
}

/** Tarjeta unificada de movimientos (entradas · salidas · limpiezas): número y etiqueta en mayúsculas, compacta, con leyenda del plazo. */
export default function MovementsCard({ checkIns, checkOuts, cleanings, unassigned, lookaheadDays, className }: MovementsCardProps) {
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
    },
    {
      to: '/reservas',
      icon: LogOut,
      color: '#F97316',
      bg: 'var(--or-chip-bg)',
      value: checkOuts,
      label: t('dash.salidas'),
      ariaLabel: t('dash.salidas'),
    },
    {
      to: '/limpieza',
      icon: Sparkles,
      color: '#8B5CF6',
      bg: 'var(--vi-chip-bg)',
      value: cleanings,
      label: t('dash.limpiezas'),
      ariaLabel: t('dash.limpiezas'),
    },
  ];

  return (
    <div className={`card flex h-full flex-col justify-between gap-1 p-2 ${className ?? ''}`}>
      <p
        className="text-[10px] font-semibold uppercase leading-4 tracking-[0.08em]"
        style={{ color: 'var(--text-faint)' }}
      >
        {t('dash.proximosDias', { days: lookaheadDays })}
      </p>
      <div className="flex flex-col">
        {rows.map(({ to, icon: Icon, color, bg, value, label, ariaLabel }) => (
          <Link
            key={to + label}
            to={to}
            aria-label={ariaLabel}
            className="flex items-center gap-2.5 rounded-lg px-1 py-[3px] transition-colors duration-150 hover:bg-[var(--surface-2)]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: bg }}>
              <Icon className="h-4 w-4" style={{ color }} strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="font-display tnum text-[19px] font-semibold leading-6" style={{ color: 'var(--text)' }}>
                {value}
              </span>
              <span className="font-display text-[16px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {label}
              </span>
            </span>
            {to === '/limpieza' && unassigned > 0 && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                style={{ backgroundColor: 'var(--ro-chip-bg)', color: '#F43F5E' }}
              >
                {t('dash.porAsignar', { count: unassigned })}
              </span>
            )}
            {to === '/limpieza' && unassigned === 0 && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                style={{ backgroundColor: 'var(--em-chip-bg)', color: '#10B981' }}
              >
                {t('dash.sinAsignar', { count: 0 })}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
