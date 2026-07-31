import { Minus, Plus } from 'lucide-react';
import { fmtNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

interface HoursStepperProps {
  value: number;
  onChange: (hours: number) => void;
  min?: number;
  max?: number;
  /** compact = stepper inline pequeño (tarjetas); por defecto tamaño dialog */
  compact?: boolean;
  ariaLabel?: string;
}

/** Stepper de horas en saltos de 0,5 h (asignación y confirmación de limpieza). */
export default function HoursStepper({
  value,
  onChange,
  min = 0.5,
  max = 12,
  compact = false,
  ariaLabel = 'horas',
}: HoursStepperProps) {
  const step = (delta: number) =>
    onChange(Math.min(max, Math.max(min, Math.round((value + delta) * 2) / 2)));

  return (
    <div className={cn('flex items-center', compact ? 'gap-2' : 'gap-4')}>
      <button
        type="button"
        onClick={() => step(-0.5)}
        aria-label={`Restar media hora (${ariaLabel})`}
        className={cn(
          'flex items-center justify-center rounded-xl border transition-colors hover:bg-[var(--surface-2)] disabled:opacity-40',
          compact ? 'h-8 w-8' : 'h-10 w-10',
        )}
        style={{ borderColor: 'var(--border)' }}
        disabled={value <= min}
      >
        <Minus className="h-4 w-4" />
      </button>
      <p
        className={cn(
          'font-display tnum text-center font-semibold',
          compact ? 'w-14 text-[15px]' : 'w-24 text-xl',
        )}
      >
        {fmtNumber(value, 1)}{' '}
        <span className="text-[0.6em] font-medium" style={{ color: 'var(--text-faint)' }}>
          h
        </span>
      </p>
      <button
        type="button"
        onClick={() => step(0.5)}
        aria-label={`Sumar media hora (${ariaLabel})`}
        className={cn(
          'flex items-center justify-center rounded-xl border transition-colors hover:bg-[var(--surface-2)] disabled:opacity-40',
          compact ? 'h-8 w-8' : 'h-10 w-10',
        )}
        style={{ borderColor: 'var(--border)' }}
        disabled={value >= max}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
