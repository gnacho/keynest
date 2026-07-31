import type { Property } from '@/data/types';
import { cn } from '@/lib/utils';

interface PropertyAvatarProps {
  property: Property;
  size?: number;
  className?: string;
}

/** Cuadrado radius 12px con foto del inmueble (o iniciales sobre gradiente marca). */
export default function PropertyAvatar({ property, size = 40, className }: PropertyAvatarProps) {
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl', className)}
      style={{ width: size, height: size }}
    >
      {property.photo ? (
        <img src={property.photo} alt={property.name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="brand-gradient flex h-full w-full items-center justify-center font-display text-sm font-semibold text-white">
          {property.name
            .split(' ')
            .map((w) => w[0])
            .slice(0, 2)
            .join('')}
        </span>
      )}
    </span>
  );
}
