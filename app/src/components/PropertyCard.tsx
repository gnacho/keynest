import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { BedDouble, BookOpen, CalendarDays, Pencil, Ruler, Sparkles, TrendingUp } from 'lucide-react';
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

interface PropertyCardProps {
  property: Property;
  className?: string;
}

/**
 * Patrón clave (design.md §7.3): foto 16:9 + pill de ocupación + nombre/dirección
 * + chips dorm/m² + fila de 4 botones que navegan a la vista filtrada ?inmueble=<slug>.
 */
export default function PropertyCard({ property, className }: PropertyCardProps) {
  const { t } = useTranslation();
  const { getOccupancy } = useData();
  const reduce = useReducedMotion();
  const occ = getOccupancy(property.id, new Date());

  return (
    <motion.article
      className={cn('card group overflow-hidden transition-shadow duration-200 hover:shadow-lg hover:shadow-[var(--brand-from)]/10', className)}
      style={{ borderColor: 'var(--border)' }}
      whileHover={reduce ? undefined : { y: -2 }}
      whileTap={reduce ? undefined : { scale: 0.99 }}
      transition={{ duration: 0.18 }}
    >
      <div className="relative aspect-video overflow-hidden">
        <img
          src={property.photo}
          alt={property.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 ease-out-quart group-hover:scale-[1.04]"
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, transparent 40%, rgb(0 0 0 / 0.45) 100%)' }}
        />
        {/* Pill de estado de ocupación */}
        <span
          className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md"
          style={
            occ.occupied
              ? { backgroundColor: 'rgb(59 130 246 / 0.9)', color: '#fff' }
              : { backgroundColor: 'rgb(15 23 42 / 0.55)', color: '#E2E8F0' }
          }
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', occ.occupied ? 'bg-white' : 'bg-slate-300')} />
          {occ.occupied
            ? t('common2.ocupado')
            : occ.freeSince
              ? t('common2.libreDesde', { date: fmtDateShort(occ.freeSince) })
              : t('common2.libre')}
        </span>
        <div className="absolute bottom-3 left-3 right-3">
          <p className="font-display text-[17px] font-semibold leading-5 text-white">{property.name}</p>
          <p className="text-xs text-white/80">{property.address}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pt-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
        >
          <BedDouble className="h-3.5 w-3.5" />
          <span className="font-display tnum text-xs">{property.bedrooms}</span>
          <span className="text-[10px] font-medium">dorm</span>
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
        >
          <Ruler className="h-3.5 w-3.5" />
          <span className="font-display tnum text-xs">{property.area}</span>
          <span className="text-[10px] font-medium">m²</span>
        </span>
        <Link
          to={`/inmuebles`}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-lg opacity-0 transition-all duration-150 group-hover:opacity-100 hover:bg-[var(--surface-2)]"
          style={{ color: 'var(--text-faint)' }}
        >
          <Pencil className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-0.5 px-2 pb-2 pt-1.5">
        {ACTIONS.map(({ to, label, icon: Icon, color }) => (
          <motion.div key={to} whileTap={reduce ? undefined : { scale: 0.94 }}>
            <Link
              to={`${to}?inmueble=${property.slug}`}
              className="flex flex-col items-center gap-1 rounded-xl py-2 transition-colors duration-150 hover:bg-[var(--surface-2)]"
            >
              <Icon className="h-[18px] w-[18px]" style={{ color }} strokeWidth={2} />
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                {label}
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.article>
  );
}
