import { Blinds, Droplets, Lock, Sofa, Thermometer, Wrench, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Mapa nombre → icono para el maestro de categorías de mantenimiento. */
export const CAT_ICONS: Record<string, LucideIcon> = {
  lock: Lock,
  zap: Zap,
  droplets: Droplets,
  thermometer: Thermometer,
  sofa: Sofa,
  blinds: Blinds,
  wrench: Wrench,
};

export function catIcon(name: string): LucideIcon {
  return CAT_ICONS[name] ?? Wrench;
}
