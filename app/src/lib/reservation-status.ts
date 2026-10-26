import type { ReservationStatus, SemColor } from '@/data/types';

export interface ReservationStateInput {
  checkIn: Date;
  checkOut: Date;
  airbnbStatus?: string;
  airbnbCancellationStatus?: string;
}

export function isPendingBookingStatus(status?: string): boolean {
  return ['request', 'pending'].includes((status ?? '').trim().toLowerCase());
}

export function isPendingCancellationStatus(status?: string): boolean {
  return ['PENDING', 'PENDING_REVIEW', 'REQUESTED'].includes((status ?? '').trim().toUpperCase());
}

export function reservationStatusFor(input: ReservationStateInput, now = Date.now()): ReservationStatus {
  if (input.checkOut.getTime() < now) return 'completada';
  if (isPendingCancellationStatus(input.airbnbCancellationStatus)) return 'pendienteCancelacion';
  if (isPendingBookingStatus(input.airbnbStatus)) return 'pendiente';
  if (input.checkIn.getTime() <= now) return 'activa';
  return 'confirmada';
}

export function reservationStatusKey(status: ReservationStatus, syncPending = false): string {
  return syncPending ? 'res.pendienteSincronizacion' : `estadoReserva.${status}`;
}

export function reservationStatusTone(status: ReservationStatus, syncPending = false): SemColor {
  if (syncPending) return 'orange';
  if (status === 'pendienteCancelacion') return 'rose';
  if (status === 'pendiente') return 'orange';
  if (status === 'activa') return 'emerald';
  if (status === 'confirmada') return 'blue';
  return 'slate';
}
