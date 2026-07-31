import type { DataApi } from '@/data/data-context';
import { addDays, startOfDay } from '@/lib/format';

export interface FreeWindow {
  /** Primer día libre (a las 00:00) */
  start: Date;
  /** Días consecutivos libres */
  days: number;
  /** Check-in que cierra el hueco (si existe en el horizonte) */
  nextCheckIn?: Date;
}

/**
 * Primera ventana de desocupación de un inmueble, computada del calendario
 * de reservas (día a día, horizonte 90 días).
 */
export function getFreeWindow(data: DataApi, propertyId: string, from: Date = new Date()): FreeWindow | undefined {
  const today = startOfDay(from);
  for (let i = 0; i < 90; i++) {
    const d = addDays(today, i);
    if (data.getActiveReservation(propertyId, d)) continue;
    let days = 0;
    let nextCheckIn: Date | undefined;
    for (let j = i; j < i + 90; j++) {
      const d2 = addDays(today, j);
      const r = data.getActiveReservation(propertyId, d2);
      if (r) {
        nextCheckIn = r.checkIn;
        break;
      }
      days++;
    }
    return { start: d, days, nextCheckIn };
  }
  return undefined;
}
