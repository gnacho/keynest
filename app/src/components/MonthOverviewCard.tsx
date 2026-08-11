import { Link } from 'react-router';
import { animate, useReducedMotion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { BedDouble, CalendarCheck2, Euro } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkline } from '@/components/Sparkline';
import { fmtNumber, fmtPct } from '@/lib/format';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

interface Metric {
  icon: LucideIcon;
  color: string;
  bg: string;
  label: string;
  value: string;
  to: string;
  big?: boolean;
}

interface MonthOverviewCardProps {
  occupancyPct: number;
  spark: number[];
  income: number;
  reservationsCount: number;
  className?: string;
}

/** Ocupación actual + datos del mes en curso (ingresos previstos, reservas). */
export default function MonthOverviewCard({ occupancyPct, spark, income, reservationsCount, className }: MonthOverviewCardProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const controls = animate(0, occupancyPct, {
      duration: 0.9,
      ease: EASE_OUT_QUART,
      onUpdate: (v) => setAnimated(v),
    });
    return () => controls.stop();
  }, [occupancyPct, reduce]);

  const display = reduce ? occupancyPct : animated;

  const metrics: Metric[] = [
    {
      icon: Euro,
      color: '#10B981',
      bg: 'var(--em-chip-bg)',
      label: t('dash.ingresosPrevistosMes'),
      value: `${fmtNumber(income)} €`,
      to: '/rentabilidad',
      big: true,
    },
    {
      icon: CalendarCheck2,
      color: '#6366F1',
      bg: 'var(--vi-chip-bg)',
      label: t('dash.reservasMesLabel'),
      value: String(reservationsCount),
      to: '/reservas',
    },
  ];

  return (
    <div className={`card flex h-full flex-col gap-1.5 p-1.5 ${className ?? ''}`}>
      <p
        className="text-[9px] font-semibold uppercase leading-3 tracking-[0.08em]"
        style={{ color: 'var(--text-faint)' }}
      >
        {t('dash.tusInmueblesEsteMes')}
      </p>
      <div className="flex flex-col">
        <Link
          to="/calendario"
          className="flex items-center gap-2 rounded-lg px-1 py-1 transition-colors duration-150 hover:bg-[var(--surface-2)]"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--bl-chip-bg)' }}>
            <BedDouble className="h-3.5 w-3.5" style={{ color: '#3B82F6' }} strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('dash.ocupacionActual')}
            </span>
            <span className="font-display tnum text-[17px] font-semibold leading-5" style={{ color: 'var(--text)' }}>
              {fmtPct(display)}
            </span>
          </span>
          {spark.length > 1 && (
            <span className="h-6 w-12 shrink-0">
              <Sparkline data={spark} color="#3B82F6" />
            </span>
          )}
        </Link>

        {metrics.map(({ icon: Icon, color, bg, label, value, to, big }) => (
          <Link
            key={to + label}
            to={to}
            className="flex items-center gap-2 rounded-lg px-1 py-1 transition-colors duration-150 hover:bg-[var(--surface-2)]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: bg }}>
              <Icon className="h-3.5 w-3.5" style={{ color }} strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {label}
            </span>
            <span
              className="shrink-0 font-display tnum font-semibold"
              style={{ color: 'var(--text)', fontSize: big ? '20px' : '17px', lineHeight: '1.4' }}
            >
              {value}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
