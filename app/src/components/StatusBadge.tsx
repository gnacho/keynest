import { cn } from '@/lib/utils';
import { CHIP_COLORS, STATUS_CATALOG, chipStyle } from '@/lib/semantic';
import type { SemColor } from '@/data/types';

interface StatusBadgeProps {
  label: string;
  tone?: SemColor;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

/** Pill 999px con tint semántico claro/oscuro, texto 12px 600, dot 6px opcional. */
export default function StatusBadge({ label, tone, dot = false, pulse = false, className }: StatusBadgeProps) {
  const t = tone ?? STATUS_CATALOG[label] ?? 'slate';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5',
        className,
      )}
      style={chipStyle(t)}
    >
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', pulse && 'animate-dot-pulse')}
          style={{ backgroundColor: CHIP_COLORS[t].dot }}
        />
      )}
      {label}
    </span>
  );
}
