import { useContext } from 'react';
import { DataContext } from './data-context';
import type { DataApi } from './data-context';

/** Hook de acceso a la capa de datos mock (separado del provider por react-refresh). */
export function useData(): DataApi {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData debe usarse dentro de <DataProvider>');
  return ctx;
}
