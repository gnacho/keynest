import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { LogIn, LogOut, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Item {
  to: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  value: number;
  ariaLabel: string;
}

interface MovementsCardProps {
  checkIns: number;
  checkOuts: number;
  cleanings: number;
  unassigned: number;
  className?: string;
}

/** Tarjeta unificada de movimientos (entradas · salidas · limpiezas) con 3 iconos+números. */
export default function MovementsCard({ checkIns, checkOuts, cleanings, unassigned, className }: MovementsCardProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();

  const items: Item[] = [
    { to: '/reservas', icon: LogIn, color: '#10B981', bg: 'var(--em-chip-bg)', value: checkIns, ariaLabel: t('dash.entradas') },
    { to: '/reservas', icon: LogOut, color: '#F97316', bg: 'var(--or-chip-bg)', value: checkOuts, ariaLabel: t('dash.salidas') },
    { to: '/limpieza', icon: Sparkles, color: '#8B5CF6', bg: 'var(--vi-chip-bg)', value: cleanings, ariaLabel: t('dash.limpiezas') },
  ];

  return (
    <div className={`card flex h-full flex-col justify-between gap-3 p-3 ${className ?? ''}`}>
      <div className="flex items-center justify-around gap-1">
        {items.map(({ to, icon: Icon, color, bg, value, ariaLabel }) => (
          <Link
            key={to + ariaLabel}
            to={to}
            aria-label={ariaLabel}
            className="flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition-colors duration-150 hover:bg-[var(--surface-2)]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: bg }}>
              <Icon className="h-[18px] w-[18px]" style={{ color }} strokeWidth={2} />
            </span>
            <span className="font-display tnum text-[20px] font-semibold leading-6" style={{ color: 'var(--text)' }}>
              {value}
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
