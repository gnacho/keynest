import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CHIP_COLORS, chipDot, chipStyle } from '@/lib/semantic';
import type { SemColor } from '@/data/types';
import { cn } from '@/lib/utils';
import { parseTipoParam, serializeTipoParam } from './calendar-utils';
import type { ActiveFilters } from './calendar-utils';

const CHIPS: { key: keyof ActiveFilters; labelKey: string; tone: SemColor }[] = [
  { key: 'entrada', labelKey: 'cal.entrada', tone: 'emerald' },
  { key: 'salida', labelKey: 'cal.salida', tone: 'orange' },
  { key: 'estancia', labelKey: 'cal.estancia', tone: 'blue' },
  { key: 'desocupado', labelKey: 'cal.desocupado', tone: 'slate' },
];

/**
 * Chips multi-toggle de tipo de día (leyenda integrada del calendario).
 * Escribe ?tipo=<lista de desactivados>; al desactivar, el grid atenúa esos marcadores.
 */
export default function TipoChips() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const active = parseTipoParam(params.get('tipo'));

  const toggle = (key: keyof ActiveFilters) => {
    const next = { ...active, [key]: !active[key] };
    const serialized = serializeTipoParam(next);
    const p = new URLSearchParams(params);
    if (serialized === null) p.delete('tipo');
    else p.set('tipo', serialized);
    setParams(p, { replace: true });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('cal.tiposDia')}>
      {CHIPS.map(({ key, labelKey, tone }) => {
        const on = active[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(key)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all duration-150',
              !on && 'opacity-60',
            )}
            style={
              on
                ? { ...chipStyle(tone), borderColor: 'transparent' }
                : {
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text-faint)',
                    borderColor: 'var(--border)',
                  }
            }
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: on ? chipDot(tone) : CHIP_COLORS.slate.dot }}
            />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
