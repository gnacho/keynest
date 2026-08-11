import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { BedDouble, BookOpen, CalendarDays, Settings2, Ruler, Sparkles, TrendingUp } from 'lucide-react';
import type { Property } from '@/data/types';
import { useData } from '@/data/useData';
import PropertyAvatar from '@/components/PropertyAvatar';
import { fmtDateShort } from '@/lib/format';
import { cn } from '@/lib/utils';

const ACTIONS = [
  { to: '/calendario', label: 'Calendario', icon: CalendarDays, color: '#3B82F6' },
  { to: '/reservas', label: 'Reservas', icon: BookOpen, color: '#10B981' },
  { to: '/limpieza', label: 'Limpieza', icon: Sparkles, color: '#8B5CF6' },
  { to: '/rentabilidad', label: 'Rentabilidad', icon: TrendingUp, color: '#6366F1' },
] as const;

interface PropertyCardProps {
  property: Property;
  className?: string;
}

/** Tarjeta compacta de inmueble: sin foto, fila con avatar + nombre + números + acciones. */
export default function PropertyCard({ property, className }: PropertyCardProps) {
  const { t } = useTranslation();
  const { getOccupancy } = useData();
  const reduce = useReducedMotion();
  const occ = getOccupancy(property.id, new Date());

  return (
    <motion.article
      className={cn('card group flex flex-col gap-2 p-3 transition-shadow duration-200 hover:shadow-lg hover:shadow-[var(--brand-from)]/10', className)}
      style={{ borderColor: 'var(--border)' }}
      whileHover={reduce ? undefined : { y: -1 }}
      whileTap={reduce ? undefined : { scale: 0.99 }}
      transition={{ duration: 0.18 }}
    >
      {/* Fila superior: avatar + nombre/dirección + estado + editar */}
      <div className="flex items-start gap-2.5">
        <PropertyAvatar property={property} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">{property.name}</p>
          <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            {occ.occupied
              ? t('common2.ocupado')
              : occ.freeSince
                ? t('common2.libreDesde', { date: fmtDateShort(occ.freeSince) })
                : t('common2.libre')}
          </p>
        </div>
        <Link
          to={`/inmuebles?editar=${property.id}`}
          className="group/edit flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: 'var(--text-faint)' }}
        >
          <Settings2 className="h-4 w-4 transition-transform duration-300 group-hover/edit:rotate-90" />
        </Link>
      </div>

      {/* Fila números: icono + número en la misma horizontal */}
      <div className="flex items-center gap-4">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
          <BedDouble className="h-4 w-4" style={{ color: '#8B5CF6' }} />
          <span className="font-display tnum">{property.bedrooms}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
          <Ruler className="h-4 w-4" style={{ color: '#3B82F6' }} />
          <span className="font-display tnum">{property.area}</span>
        </span>
      </div>

      {/* Fila de acciones: solo iconos */}
      <div className="flex items-center gap-1 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
        {ACTIONS.map(({ to, icon: Icon, color }) => (
          <motion.div key={to} whileTap={reduce ? undefined : { scale: 0.94 }} className="flex-1">
            <Link
              to={`${to}?inmueble=${property.slug}`}
              className="flex items-center justify-center rounded-lg py-1.5 transition-colors duration-150 hover:bg-[var(--surface-2)]"
            >
              <Icon className="h-[18px] w-[18px]" style={{ color }} strokeWidth={2} />
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.article>
  );
}
