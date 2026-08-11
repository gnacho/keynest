import { Link } from 'react-router';
import { intlLocale } from '@/i18n';
import { useEffect, useRef, useState } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
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

const SPARK_W = 64;
const SPARK_H = 28;
const SPARK_PAD = 2;

// Curva monotone cúbica (equivalente al type="monotone" de recharts)
function sparkLinePath(data: number[]): string {
  const n = data.length;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = SPARK_PAD + (i * (SPARK_W - SPARK_PAD * 2)) / (n - 1);
    const y = SPARK_H - SPARK_PAD - ((v - min) / range) * (SPARK_H - SPARK_PAD * 2);
    return { x, y };
  });

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x || 1e-6;
    slope[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const t: number[] = [];
  t[0] = slope[0];
  t[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = slope[i - 1] === 0 || slope[i] === 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * slope[i];
      t[i + 1] = k * b * slope[i];
    }
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const c1x = p0.x + dx[i] / 3;
    const c1y = p0.y + (t[i] * dx[i]) / 3;
    const c2x = p1.x - dx[i] / 3;
    const c2y = p1.y - (t[i + 1] * dx[i]) / 3;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

function Sparkline({ data, color, reduce }: { data: number[]; color: string; reduce: boolean }) {
  const line = sparkLinePath(data);
  const area = `${line} L ${SPARK_W - SPARK_PAD} ${SPARK_H} L ${SPARK_PAD} ${SPARK_H} Z`;
  const gid = `spark-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  const spring = { delay: 0.3, duration: 0.8, ease: 'easeOut' as const };

  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill={`url(#${gid})`}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={spring}
      />
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={spring}
      />
    </svg>
  );
}

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
    'card flex h-full flex-col gap-1.5 p-3',
    to && 'transition-all duration-150 hover:-translate-y-0.5 hover:shadow-overlay',
    className,
  );

  const inner = (
    <>
      <p
        className="text-[10px] font-semibold uppercase leading-4 tracking-[0.08em]"
        style={{ color: 'var(--text-faint)' }}
      >
        {label}
      </p>
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: TINT[tone].bg }}
        >
          <Icon className="h-[18px] w-[18px]" style={{ color: TINT[tone].fg }} strokeWidth={2} />
        </span>
        <p className="min-w-0 flex-1 font-display tnum text-[22px] font-semibold leading-8 tracking-[-0.02em]">
          {prefix}
          {formatted}
          {unit && (
            <span className="whitespace-nowrap font-medium" style={{ fontSize: '0.6em', color: 'var(--text-faint)', marginLeft: 2 }}>
              {unit}
            </span>
          )}
        </p>
        {spark && spark.length > 1 && (
          <div className="h-7 w-14 shrink-0">
            <Sparkline data={spark} color={sparkColor ?? TINT[tone].fg} reduce={!!reduce} />
          </div>
        )}
      </div>
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
