import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, Sparkles, TrendingUp } from 'lucide-react';
import type { Property } from '@/data/types';
import { useData } from '@/data/useData';
import { fmtDateShort } from '@/lib/format';
import { cn } from '@/lib/utils';

const ACTIONS = [
  { to: '/calendario', label: 'Calendario', icon: CalendarDays, color: '#3B82F6' },
  { to: '/reservas', label: 'Reservas', icon: BookOpen, color: '#10B981' },
  { to: '/limpieza', label: 'Limpieza', icon: Sparkles, color: '#8B5CF6' },
  { to: '/rentabilidad', label: 'Rentabilidad', icon: TrendingUp, color: '#6366F1' },
] as const;

interface PropertyRowProps {
  property: Property;
  className?: string;
}

/**
 * Variante compacta de PropertyCard para el Dashboard: thumb 56px + nombre/dirección
 * + pill de ocupación + 4 acciones icono que navegan a ?inmueble=<slug>.
 * Reduce (mucho) la huella vertical frente a la tarjeta 16:9 completa.
 */
export default function PropertyRow({ property, className }: PropertyRowProps) {
  const { t } = useTranslation();
  const { getOccupancy } = useData();
  const occ = getOccupancy(property.id, new Date());

  return (
    <div className={cn('flex items-center gap-3 px-3 py-2.5 sm:px-4', className)}>
      <img
        src={property.photo}
        alt={property.name}
        loading="lazy"
        className="h-12 w-12 shrink-0 rounded-xl object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-display text-[15px] font-semibold leading-5">
            {property.name}
          </p>
          <span
            className="hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold sm:inline-flex"
            style={
              occ.occupied
                ? { backgroundColor: 'var(--bl-chip-bg)', color: 'var(--bl-chip-text)' }
                : { backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }
            }
          >
            <span
              className={cn('h-1.5 w-1.5 rounded-full', occ.occupied ? 'bg-blue-500' : 'bg-slate-400')}
            />
            {occ.occupied ? t('common2.ocupado') : occ.freeSince ? t('common2.libreDesde', { date: fmtDateShort(occ.freeSince) }) : t('common2.libre')}
          </span>
        </div>
        <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
          {property.address} · {property.bedrooms} dorm · {property.area} m²
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {ACTIONS.map(({ to, label, icon: Icon, color }) => (
          <Link
            key={to}
            to={`${to}?inmueble=${property.slug}`}
            title={label}
            aria-label={`${label} de ${property.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-150 hover:bg-[var(--surface-2)]"
          >
            <Icon className="h-[17px] w-[17px]" style={{ color }} strokeWidth={2} />
          </Link>
        ))}
      </div>
    </div>
  );
}
