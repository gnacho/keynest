import type { LucideIcon } from 'lucide-react';
import { AlertCircle, Baby, Clock, PawPrint, Wind } from 'lucide-react';

/** Icono Lucide para una petición especial (reservas.md §Fila expandida). */
export function requestIcon(request: string): LucideIcon {
  const s = request.toLowerCase();
  if (s.includes('cuna') || s.includes('bebé') || s.includes('bebe')) return Baby;
  if (s.includes('check-out') || s.includes('check-in') || s.includes('late')) return Clock;
  if (s.includes('perro') || s.includes('gato') || s.includes('mascota')) return PawPrint;
  if (s.includes('plumón') || s.includes('plumon') || s.includes('alergia')) return Wind;
  return AlertCircle;
}
