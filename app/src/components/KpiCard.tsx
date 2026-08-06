import { Link } from 'react-router';
import { intlLocale } from '@/i18n';
import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { SemColor } from '@/data/types';
import { fmtNumber, fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';

const TINT: Record<SemColor, { bg: string; fg: string }> = {
  emerald: { bg: 'var(--em-chip-bg)', fg: '#10B981' },
  orange: { bg: 'var(--or-chip-bg)', fg: '#F97316' },
  blue: { bg: 'var(--bl-chip-bg)', fg: '#3B82F6' },
  slate: { bg: 'var(--sl-chip-bg)', fg: '#64748B' },
  violet: { bg: 'var(--vi-chip-bg)', fg: '#8B5CF6' },
  rose: { bg: 'var(--ro-chip-bg)', fg: '#F43F5E' },
  indigo: { bg: 'rgb(99 102 241 / 0.12)', fg: '#6366F1' },
};

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

interface KpiCardProps {
  icon: LucideIcon;
  tone: SemColor;
  label: string;
  value: number;
  /** Unidad pequeña al 60 % ("€", "%", "h") */
  unit?: string;
  /** Prefijo (p. ej. "+") */
  prefix?: string;
  decimals?: number;
  /** Delta vs período anterior en % (flecha ↑ emerald / ↓ rose) */
  deltaPct?: number;
  sub?: string;
  spark?: number[];
  sparkColor?: string;
  /** Formato moneda es-ES */
  money?: boolean;
  /** Si se indica, la tarjeta enlaza a esa ruta. */
  to?: string;
  className?: string;
}

export default function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  unit,
  prefix,
  decimals = 0,
  deltaPct,
  sub,
  spark,
  sparkColor,
  money = false,
  to,
  className,
}: KpiCardProps) {
  const reduce = useReducedMotion();
  const [animated, setAnimated] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce) return; // valor final directo, sin count-up
    const controls = animate(0, value, {
      duration: 0.9,
      ease: EASE_OUT_QUART,
      onUpdate: (v) => setAnimated(v),
    });
    return () => controls.stop();
  }, [value, reduce]);

  const display = reduce ? value : animated;

  const formatted = money
    ? new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }).format(display)
    : fmtNumber(display, decimals);

  const up = (deltaPct ?? 0) >= 0;

  const rootCls = cn(
    'card flex flex-col gap-2 p-4',
    to && 'transition-all duration-150 hover:-translate-y-0.5 hover:shadow-overlay',
    className,
  );

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ backgroundColor: TINT[tone].bg }}
        >
          <Icon className="h-[18px] w-[18px]" style={{ color: TINT[tone].fg }} strokeWidth={2} />
        </span>
        {spark && spark.length > 1 && (
          <div className="h-7 w-16">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark.map((v, i) => ({ i, v }))} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={sparkColor ?? TINT[tone].fg}
                  strokeWidth={1.8}
                  fill={sparkColor ?? TINT[tone].fg}
                  fillOpacity={0.14}
                  isAnimationActive={!reduce}
                  animationBegin={300}
                  animationDuration={800}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <p
        className="text-[11px] font-semibold uppercase leading-4 tracking-[0.08em]"
        style={{ color: 'var(--text-faint)' }}
      >
        {label}
      </p>
      <p className="font-display tnum text-[28px] font-semibold leading-8 tracking-[-0.02em]">
        {prefix}
        {formatted}
        {unit && (
          <span className="font-medium" style={{ fontSize: '0.6em', color: 'var(--text-faint)', marginLeft: 2 }}>
            {unit}
          </span>
        )}
      </p>
      <div className="flex items-center gap-2">
        {deltaPct !== undefined && (
          <span
            className="inline-flex items-center gap-0.5 text-xs font-semibold"
            style={{ color: up ? '#10B981' : '#F43F5E' }}
          >
            {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {fmtPct(Math.abs(deltaPct))}
          </span>
        )}
        {sub && (
          <span className="truncate text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            {sub}
          </span>
        )}
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={rootCls}>
        {inner}
      </Link>
    );
  }
  return (
    <div ref={ref} className={rootCls}>
      {inner}
    </div>
  );
}
