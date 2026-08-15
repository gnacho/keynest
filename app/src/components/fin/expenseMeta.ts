import type { ExpenseType } from '@/data/types';

/** Paleta fija del quesito de gastos (rentabilidad.md §Sección 2 / ajustes.md Tab 3). */
export const EXPENSE_META: Record<ExpenseType, { label: string; labelKey: string; color: string }> = {
  agua: { label: 'Agua', labelKey: 'gastoTipo.agua', color: '#0EA5E9' },
  luz: { label: 'Luz', labelKey: 'gastoTipo.luz', color: '#F59E0B' },
  internet: { label: 'Internet', labelKey: 'gastoTipo.internet', color: '#8B5CF6' },
  administración: { label: 'Administración', labelKey: 'gastoTipo.administracion', color: '#6366F1' },
  extras: { label: 'Extras', labelKey: 'gastoTipo.extras', color: '#F43F5E' },
  limpieza: { label: 'Limpieza', labelKey: 'gastoTipo.limpieza', color: '#10B981' },
};

export const EXPENSE_TYPES = Object.keys(EXPENSE_META) as ExpenseType[];

/** Swatches predefinidos para nuevos tipos de gasto (ajustes.md Tab 3). */
export const TYPE_SWATCHES = [
  '#0EA5E9',
  '#F59E0B',
  '#8B5CF6',
  '#6366F1',
  '#F43F5E',
  '#10B981',
  '#F97316',
  '#3B82F6',
];
