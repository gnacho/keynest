import type { SemColor } from '@/data/types';

/** Catálogo de estados → semántica invariable (design.md §3.2 y §7.4). */
export const STATUS_CATALOG: Record<string, SemColor> = {
  Confirmada: 'blue',
  Pendiente: 'slate',
  Completada: 'emerald',
  'En curso': 'blue',
  Asignada: 'violet',
  Nueva: 'slate',
  Finalizada: 'emerald',
  Urgente: 'rose',
  Online: 'emerald',
  Offline: 'slate',
  Ocupado: 'blue',
  Libre: 'slate',
  Entrada: 'emerald',
  Salida: 'orange',
};

export const CHIP_COLORS: Record<SemColor, { bg: string; text: string; dot: string }> = {
  emerald: { bg: 'var(--em-chip-bg)', text: 'var(--em-chip-text)', dot: '#10B981' },
  orange: { bg: 'var(--or-chip-bg)', text: 'var(--or-chip-text)', dot: '#F97316' },
  blue: { bg: 'var(--bl-chip-bg)', text: 'var(--bl-chip-text)', dot: '#3B82F6' },
  slate: { bg: 'var(--sl-chip-bg)', text: 'var(--sl-chip-text)', dot: '#64748B' },
  violet: { bg: 'var(--vi-chip-bg)', text: 'var(--vi-chip-text)', dot: '#8B5CF6' },
  rose: { bg: 'var(--ro-chip-bg)', text: 'var(--ro-chip-text)', dot: '#F43F5E' },
  indigo: { bg: 'rgb(99 102 241 / 0.12)', text: '#6366F1', dot: '#6366F1' },
};

export function chipStyle(tone: SemColor): { backgroundColor: string; color: string } {
  return { backgroundColor: CHIP_COLORS[tone].bg, color: CHIP_COLORS[tone].text };
}

export function chipDot(tone: SemColor): string {
  return CHIP_COLORS[tone].dot;
}
