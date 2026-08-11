import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
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

/** Tarjeta unificada de movimientos (entradas · salidas · limpiezas): número y etiqueta al mismo tamaño, con leyenda del plazo. */
export default function MovementsCard({ checkIns, checkOuts, cleanings, unassigned, lookaheadDays, className }: MovementsCardProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();

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
    <div className={`card flex h-full flex-col justify-between gap-3 p-3 ${className ?? ''}`}>
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
            className="flex items-center gap-3 rounded-xl px-1 py-1.5 transition-colors duration-150 hover:bg-[var(--surface-2)]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: bg }}>
              <Icon className="h-[18px] w-[18px]" style={{ color }} strokeWidth={2} />
            </span>
            <span className="flex items-baseline gap-2">
              <span className="font-display tnum text-[22px] font-semibold leading-7" style={{ color: 'var(--text)' }}>
                {value}
              </span>
              <span className="font-display text-[17px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                {label}
              </span>
            </span>
          </Link>
        ))}
      </div>
      <div className="flex items-center justify-center gap-1.5">
        <motion.span
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="text-xs font-medium"
          style={{ color: unassigned > 0 ? '#F43F5E' : 'var(--text-muted)' }}
        >
          {t('dash.limpiezasSinAsignar', { count: unassigned })}
        </motion.span>
      </div>
    </div>
  );
}
