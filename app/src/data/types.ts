/** Interfaces del dominio Keynest (design.md §8). */

export type SemColor = 'emerald' | 'orange' | 'blue' | 'slate' | 'violet' | 'rose' | 'indigo';

export interface Property {
  id: string;
  slug: string;
  name: string;
  address: string;
  bedrooms: number;
  bathrooms: number;
  area: number; // m²
  photo: string;
  /** Checklist de limpieza propio del inmueble (texto libre, un check por línea). */
  checklist: string[];
  /** Instrucciones de limpieza del inmueble (texto largo: acceso, productos, peculiaridades). Distinto del checklist. */
  instructions: string;
  /** URL iCal de Airbnb para sincronizar reservas (vacío = sin sync). */
  icalUrl?: string;
}

export interface Guest {
  name: string;
  country: string;
  initials: string;
}

export type ReservationStatus = 'confirmada' | 'activa' | 'pendiente' | 'completada';

export interface Reservation {
  id: string;
  propertyId: string;
  guest: Guest;
  checkIn: Date;
  checkOut: Date;
  guestsCount: number;
  guestAges: number[];
  status: ReservationStatus;
  amount: number; // EUR total estancia (manual: iCal no lo trae)
  specialRequest?: string;
  /** Notas libres del propietario sobre la reserva. */
  notes?: string;
  /** Fecha REAL de reserva (CSV Airbnb); '' = desconocida (p.ej. venidas del iCal). */
  bookedDate?: string;
}

export type AccessType = 'entrada' | 'salida' | 'remota';
export type AccessActor = 'huésped' | 'limpieza' | 'propietario';

export interface TedeeAccess {
  id: string;
  at: Date;
  actorName: string;
  actorRole: AccessActor;
  type: AccessType;
  propertyId: string;
  lockId: string;
}

export interface Lock {
  id: string;
  propertyId: string;
  name: string;
  battery: number; // %
  online: boolean;
  lastSeen: Date;
}

export type PersonRole = 'limpieza' | 'proveedor';

export interface Person {
  id: string;
  name: string;
  initials: string;
  role: PersonRole;
  specialty: string;
  hourlyRate: number; // €/h
  phone: string;
  /** true si tiene enlace de acceso por token activo (el token plano no se guarda). */
  hasToken?: boolean;
}

export interface MaintCategory {
  key: string;
  label: string;
  icon: string;
}

export type CleaningStatus = 'pendiente' | 'asignada' | 'en-curso' | 'archivada';

export interface CleaningCheck {
  id: string;
  label: string;
  done: boolean;
}

/** Horas reales trabajadas por una persona al confirmar la limpieza. */
export interface CleaningWorkEntry {
  personId: string;
  hours: number;
}

/** Línea de gasto en productos de limpieza (concepto + importe). */
export interface CleaningSupply {
  label: string;
  amount: number; // EUR
}

export interface Cleaning {
  id: string;
  propertyId: string;
  reservationId?: string;
  date: Date; // día de la limpieza (tras el check-out)
  status: CleaningStatus;
  /** Personas asignadas (0–2). */
  assigneeIds: string[];
  /** Previsión de horas POR PERSONA (al asignar; por defecto 2 h). */
  estimatedHours?: number;
  checks: CleaningCheck[];
  /** Horas reales por persona (al confirmar). */
  workLog?: CleaningWorkEntry[];
  /** Productos de limpieza (al confirmar); su suma se guarda en `materials`. */
  supplies?: CleaningSupply[];
  materials?: number; // € productos (suma de supplies)
  photos: string[];
}

/** Usuario de la app: Gestión (login usuario+contraseña) o Limpieza (acceso por enlace token). */
export interface AppUser {
  id: string;
  name: string;
  phone?: string;
  role: 'gestion' | 'limpieza';
  /** Token de acceso directo (/t/<token>) — solo rol limpieza; undefined = revocado. */
  token?: string;
  /** Vínculo con la persona del maestro (Ajustes → Personas). */
  personId?: string;
}

export type MaintenanceStatus = 'nueva' | 'asignada' | 'finalizada';

export type MaintenanceCategory =
  | 'cerradura/pilas'
  | 'electricidad'
  | 'fontanería'
  | 'climatización'
  | 'mobiliario'
  | 'persianas';

export interface MaintenanceTask {
  id: string;
  propertyId: string;
  title: string;
  category: MaintenanceCategory;
  expenseTag: string;
  status: MaintenanceStatus;
  urgent: boolean;
  scheduledDate?: Date; // fecha prevista (día desocupado)
  assigneeId?: string;
  notes: string;
  cost?: number; // coste final si finalizada
  checks?: CleaningCheck[];
  photos?: string[];
  /** true si la orden tiene enlace público por token activo. */
  hasToken?: boolean;
  createdAt: Date;
}

export type ExpenseType = 'agua' | 'luz' | 'internet' | 'administración' | 'extras';

export interface Expense {
  id: string;
  propertyId: string;
  type: ExpenseType;
  label: string;
  amount: number; // EUR
  month: number; // 0-11
  year: number;
}

export interface MonthlyFinance {
  month: number;
  year: number;
  label: string; // "may"
  income: number;
  expenses: number;
}

export interface Notification {
  id: string;
  text: string;
  time: Date;
  tone: SemColor;
  to: string;
}
