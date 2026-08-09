import { useSearchParams } from 'react-router';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import { cn } from '@/lib/utils';

interface FilterBarProps {
  /** Chips de tipo/estado opcionales (segmented control) */
  typeOptions?: { value: string; label: string }[];
  typeParam?: string; // nombre del query param (default "tipo")
  className?: string;
  /** Oculta la opción "todos" (el filtro siempre tiene un estado concreto) */
  hideAll?: boolean;
}

/**
 * Select de inmueble ("Todos los inmuebles" + 5) + chips de tipo.
 * Lee/escribe query params (?inmueble=<slug>&tipo=…). Sticky bajo el topbar en móvil.
 */
export default function FilterBar({ typeOptions, typeParam = 'tipo', className, hideAll = false }: FilterBarProps) {
  const { t } = useTranslation();
  const { getProperties } = useData();
  const [params, setParams] = useSearchParams();
  const inmueble = params.get('inmueble') ?? 'todos';
  const tipo = params.get(typeParam) ?? (hideAll ? typeOptions?.[0]?.value ?? 'todos' : 'todos');

  const setParam = (key: string, value: string, isDefault: boolean) => {
    const next = new URLSearchParams(params);
    if (isDefault) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <div
      className={cn(
        'sticky top-14 z-30 -mx-4 flex flex-wrap items-center gap-2 bg-[var(--bg)]/90 px-4 py-2 backdrop-blur-md lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none',
        className,
      )}
    >
      <Select value={inmueble} onValueChange={(v) => setParam('inmueble', v, v === 'todos')}>
        <SelectTrigger className="h-9 w-auto min-w-[180px] gap-2 rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm font-medium shadow-none">
          <SelectValue placeholder={t('cal.todosInmuebles')} />
        </SelectTrigger>
        <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
          <SelectItem value="todos">{t('cal.todosInmuebles')}</SelectItem>
          {getProperties().map((p) => (
            <SelectItem key={p.slug} value={p.slug}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {typeOptions && (
        <div className="flex max-w-full flex-wrap items-center gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          {!hideAll && (
            <button
              type="button"
              onClick={() => setParam(typeParam, 'todos', true)}
              className={cn(
                'rounded-lg px-3 py-1 text-xs font-semibold transition-colors duration-150',
                tipo === 'todos' ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
              style={tipo === 'todos' ? { backgroundImage: 'linear-gradient(135deg,#6366F1,#8B5CF6)' } : undefined}
            >
              {t('cal.todos')}
            </button>
          )}
          {typeOptions.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setParam(typeParam, o.value, false)}
              className={cn(
                'rounded-lg px-3 py-1 text-xs font-semibold transition-colors duration-150',
                tipo === o.value ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
              style={tipo === o.value ? { backgroundImage: 'linear-gradient(135deg,#6366F1,#8B5CF6)' } : undefined}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
