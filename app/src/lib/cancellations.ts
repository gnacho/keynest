/**
 * Aviso de reserva cancelada (#340): descarte persistente y desduplicado.
 *
 * Las cancelaciones llegan por dos vias a la vez (consulta inicial y evento
 * SSE), asi que el identificador de la fila de audit_log es lo que decide si
 * un aviso ya se vio. El descarte vive en localStorage y se recorta para no
 * crecer sin limite.
 */
export interface CancellationNotice {
  id: number;
  propertyId: string;
  propertyName: string;
  summary: string;
  guestName: string;
  checkin: string;
  checkout: string;
  amount: number;
  cancelledAt: number;
}

export const DISMISSED_KEY = 'keynest-cancelaciones-descartadas';
const MAX_DISMISSED = 200;

/** Lo minimo de window.localStorage que necesita este modulo (testeable sin DOM). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readDismissed(storage: StorageLike): number[] {
  try {
    const raw = JSON.parse(storage.getItem(DISMISSED_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  } catch {
    return [];
  }
}

/** Marca un aviso como descartado y devuelve la lista resultante. */
export function dismissCancellation(storage: StorageLike, id: number): number[] {
  const next = [...readDismissed(storage).filter((v) => v !== id), id].slice(-MAX_DISMISSED);
  try {
    storage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    /* cuota llena o almacenamiento deshabilitado: el aviso volvera al recargar */
  }
  return next;
}

/** Avisos a pintar: sin descartados, sin ids repetidos, el mas reciente arriba. */
export function visibleCancellations(items: CancellationNotice[], dismissed: number[]): CancellationNotice[] {
  const descartados = new Set(dismissed);
  const vistos = new Set<number>();
  return items
    .filter((i) => {
      if (descartados.has(i.id) || vistos.has(i.id)) return false;
      vistos.add(i.id);
      return true;
    })
    .sort((a, b) => b.cancelledAt - a.cancelledAt);
}

/** Quien cancela: el nombre del huesped o, si no hay, el resumen de la reserva. */
export function cancellationGuest(item: CancellationNotice): string {
  return item.guestName.trim() || item.summary.trim();
}
