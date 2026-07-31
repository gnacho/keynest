import type { ReactNode } from 'react';
import { fmtMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

interface LegendItem {
  label: string;
  color: string;
}

interface ChartCardProps {
  title: string;
  legend?: LegendItem[];
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Tarjeta contenedora de recharts: título H2 + leyenda (design.md §7.13). */
export default function ChartCard({ title, legend, action, children, className }: ChartCardProps) {
  return (
    <section className={cn('card flex flex-col gap-3 p-4 sm:p-5', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
        <div className="flex items-center gap-3">
          {legend?.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              <span className="h-2.5 w-2.5 rounded-[4px]" style={{ backgroundColor: l.color }} />
              {l.label}
            </span>
          ))}
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}

/* Tooltip custom: fondo surface, borde border, cifras tnum es-ES (design.md §7.13). */
interface TooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

export function ChartTooltip({
  active,
  payload,
  label,
  money = true,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  money?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-xl border px-3 py-2 shadow-overlay"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {label !== undefined && (
        <p className="mb-1 text-xs font-semibold capitalize" style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
      )}
      {payload.map((item, i) => (
        <p key={i} className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color ?? 'var(--text-faint)' }} />
          <span className="capitalize" style={{ color: 'var(--text-muted)' }}>
            {item.name}
          </span>
          <span className="ml-auto font-display tnum font-medium">
            {money ? fmtMoney(Number(item.value)) : item.value}
          </span>
        </p>
      ))}
    </div>
  );
}
