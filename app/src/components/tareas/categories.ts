import { Blinds, Droplets, Lock, Sofa, Thermometer, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MaintenanceCategory } from '@/data/types';

/** Catálogo de categorías de mantenimiento → icono + etiqueta (mantenimiento.md). */
export const CATEGORY_META: Record<MaintenanceCategory, { icon: LucideIcon; label: string; labelKey: string }> = {
  'cerradura/pilas': { icon: Lock, label: 'Cerradura/pilas', labelKey: 'cat.cerradura' },
  electricidad: { icon: Zap, label: 'Electricidad', labelKey: 'cat.electricidad' },
  fontanería: { icon: Droplets, label: 'Fontanería', labelKey: 'cat.fontaneria' },
  climatización: { icon: Thermometer, label: 'Climatización', labelKey: 'cat.climatizacion' },
  mobiliario: { icon: Sofa, label: 'Mobiliario', labelKey: 'cat.mobiliario' },
  persianas: { icon: Blinds, label: 'Persianas', labelKey: 'cat.persianas' },
};
