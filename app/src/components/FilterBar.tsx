import { useSearchParams } from 'react-router';
import type { ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import { cachedUser } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface FilterBarProps {
  /** Chips de tipo/estado opcionales (segmented control) */
  typeOptions?: { value: string; label: string }[];
  typeParam?: string; // nombre del query param (default "tipo")
  className?: string;
  /** Oculta la opción "todos" (el filtro siempre tiene un estado concreto) */
  hideAll?: boolean;
  /** Muestra la opción "Mis inmuebles" en el select (default true) */
  showMine?: boolean;
  /** Valor por defecto del select cuando no hay param (default "todos") */
  defaultProperty?: string;
  /** Contenido extra (p. ej. buscador) dentro de la misma fila de filtros */
  children?: ReactNode;
}

/**
 * Select de inmueble ("Todos" + "Mis inmuebles" + 5) + chips de tipo.
 * Lee/escribe query params (?inmueble=<slug|mis>&tipo=…). Sticky bajo el topbar en móvil.
 */
export default function FilterBar({ typeOptions, typeParam = 'tipo', className, hideAll = false, showMine = true, defaultProperty = 'todos', children }: FilterBarProps) {
  const { t } = useTranslation();
  const { getProperties } = useData();
  const [params, setParams] = useSearchParams();
  const tipo = params.get(typeParam) ?? (hideAll ? typeOptions?.[0]?.value ?? 'todos' : 'todos');

  const me = cachedUser();
  const hasOwn = me ? getProperties().some((p) => p.ownerId === me.id) : false;

  // Si el default es "mis" pero el usuario no tiene propiedades propias, cae a "todos".
  const effectiveDefault = defaultProperty === 'mis' && !hasOwn ? 'todos' : defaultProperty;
  const inmueble = params.get('inmueble') ?? effectiveDefault;

  const setParam = (key: string, value: string, isDefault: boolean) => {
    const next = new URLSearchParams(params);
    if (isDefault) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <Select value={inmueble} onValueChange={(v) => setParam('inmueble', v, v === 'todos')}>
          <SelectTrigger className="h-9 w-full min-w-0 flex-1 gap-2 rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm font-medium shadow-none sm:w-auto sm:min-w-[180px] sm:flex-none">
            <SelectValue placeholder={t('cal.todos')} />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
            <SelectItem value="todos">{t('cal.todos')}</SelectItem>
            {showMine && hasOwn && (
              <SelectItem value="mis">{t('cal.misInmuebles')}</SelectItem>
            )}
            {getProperties().map((p) => (
              <SelectItem key={p.slug} value={p.slug}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {children}
      </div>

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
