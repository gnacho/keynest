import i18n from '@/i18n';
import type { Property, Reservation } from '@/data/types';
import { addDays, isSameDay, startOfDay } from '@/lib/format';

/** Semántica invariable del día (calendario.md §Grid del mes). */
export type DayKind = 'entrada' | 'salida' | 'estancia' | 'rotacion' | 'libre';

export interface DayInfo {
  kind: DayKind;
  /** Reserva que entra este día */
  checkIn?: Reservation;
  /** Reserva que sale este día */
  checkOut?: Reservation;
  /** Reserva en curso (día intermedio ocupado) */
  stay?: Reservation;
}

/** Estado de un inmueble en un día concreto. */
export function dayInfoFor(reservations: Reservation[], propertyId: string, day: Date): DayInfo {
  const d = startOfDay(day).getTime();
  const mine = reservations.filter((r) => r.propertyId === propertyId);
  const inn = mine.find((r) => isSameDay(r.checkIn, day));
  const out = mine.find((r) => isSameDay(r.checkOut, day));
  if (out && inn) return { kind: 'rotacion', checkIn: inn, checkOut: out };
  if (inn) return { kind: 'entrada', checkIn: inn };
  if (out) return { kind: 'salida', checkOut: out };
  const stay = mine.find(
    (r) => startOfDay(r.checkIn).getTime() < d && d < startOfDay(r.checkOut).getTime(),
  );
  if (stay) return { kind: 'estancia', stay };
  return { kind: 'libre' };
}

/** Noches de una reserva (entero ≥ 1). */
export function nightsOf(r: Reservation): number {
  return Math.max(
    1,
    Math.round((startOfDay(r.checkOut).getTime() - startOfDay(r.checkIn).getTime()) / 86400000),
  );
}

/** Celdas del grid mensual lun–dom: 5–6 semanas × 7. */
export function monthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7; // lun = 0
  const start = addDays(first, -mondayOffset);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rows = Math.ceil((mondayOffset + daysInMonth) / 7);
  const weeks: Date[][] = [];
  for (let w = 0; w < rows; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) week.push(addDays(start, w * 7 + d));
    weeks.push(week);
  }
  return weeks;
}

export interface ActiveFilters {
  entrada: boolean;
  salida: boolean;
  estancia: boolean;
  desocupado: boolean;
}

/** Parsea ?tipo= (lista de tipos DESACTIVADOS, separados por coma). Vacío = todos activos. */
export function parseTipoParam(raw: string | null): ActiveFilters {
  const off = new Set((raw ?? '').split(',').filter(Boolean));
  return {
    entrada: !off.has('entrada'),
    salida: !off.has('salida'),
    estancia: !off.has('estancia'),
    desocupado: !off.has('desocupado'),
  };
}

/** Serializa los tipos desactivados; null cuando todos están activos. */
export function serializeTipoParam(f: ActiveFilters): string | null {
  const off = (Object.keys(f) as (keyof ActiveFilters)[]).filter((k) => !f[k]);
  return off.length ? off.join(',') : null;
}

/** ¿El marcador de este tipo queda visible (o atenuado)? */
export function kindVisible(kind: DayKind, f: ActiveFilters): boolean {
  switch (kind) {
    case 'entrada':
      return f.entrada;
    case 'salida':
      return f.salida;
    case 'estancia':
      return f.estancia;
    case 'rotacion':
      return f.entrada || f.salida;
    case 'libre':
      return f.desocupado;
  }
}

/** Desglose de edades: "2 adultos (34, 36) · 1 niño (4)" (i18n). */
export function agesBreakdown(ages: number[]): string {
  if (!ages.length) return '';
  const adults = ages.filter((a) => a >= 18).sort((a, b) => a - b);
  const kids = ages.filter((a) => a < 18).sort((a, b) => a - b);
  const parts: string[] = [];
  if (adults.length)
    parts.push(`${i18n.t('edades.adultos', { count: adults.length })} (${adults.join(', ')})`);
  if (kids.length) parts.push(`${i18n.t('edades.ninos', { count: kids.length })} (${kids.join(', ')})`);
  return parts.join(' · ');
}

/** Primera reserva futura estrictamente posterior a un día (para el EmptyState del Sheet). */
export function nextReservationAfter(
  reservations: Reservation[],
  properties: Property[],
  day: Date,
): Reservation | undefined {
  const ids = new Set(properties.map((p) => p.id));
  const t = startOfDay(day).getTime();
  return reservations
    .filter((r) => ids.has(r.propertyId) && startOfDay(r.checkIn).getTime() > t)
    .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime())[0];
}
