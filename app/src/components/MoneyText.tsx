import { fmtMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

interface MoneyTextProps {
  value: number;
  /** Colorear por signo: emerald ingreso / rose gasto */
  signed?: boolean;
  decimals?: boolean;
  className?: string;
  /** Tamaño de la unidad respecto a la cifra (design.md §4: 60 %) */
  unitScale?: number;
}

/**
 * Importe: cifra Space Grotesk 500 tnum + "€" al 60 %,
 * signo coloreado cuando aplica (design.md §7.9).
 */
export default function MoneyText({ value, signed = false, decimals, className, unitScale = 0.6 }: MoneyTextProps) {
  const formatted = fmtMoney(Math.abs(value), decimals);
  const symbol = formatted.slice(-1); // "€"
  const digits = formatted.slice(0, -1).trim();
  const sign = value < 0 ? '−' : signed ? '+' : '';
  const color = !signed
    ? undefined
    : value < 0
      ? '#F43F5E'
      : '#10B981';
  return (
    <span className={cn('font-display tnum font-medium', className)} style={color ? { color } : undefined}>
      {sign && <span>{sign}</span>}
      {digits}
      <span style={{ fontSize: `${unitScale}em`, color: signed ? undefined : 'var(--text-faint)', fontWeight: 500, marginLeft: 2 }}>
        {symbol}
      </span>
    </span>
  );
}
