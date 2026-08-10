import { createContext } from 'react';
import type {
  AppUser,
  MaintCategory,
  Cleaning,
  CleaningCheck,
  CleaningSupply,
  CleaningWorkEntry,
  Expense,
  Lock,
  MaintenanceTask,
  MonthlyFinance,
  Notification,
  Person,
  Property,
  Reservation,
  TedeeAccess,
} from './types';

export interface OccupancyInfo {
  occupied: boolean;
  reservation?: Reservation;
  /** Fecha en que quedó libre (check-out de la última reserva pasada) */
  freeSince?: Date;
}

export interface PropertyInput {
  name: string;
  address: string;
  bedrooms: number;
  bathrooms: number;
  area: number;
  photo: string;
  icalUrl: string;
  checklist: string[];
  instructions: string;
  ownerId?: string | null;
}

export interface AppSettings {
  checkInTime: string;
  checkOutTime: string;
  batteryThreshold: number;
  autoCleaning: boolean;
  lookaheadDays: number;
  nDays: number;
  dismissedNotifs: string[];
}

export interface PersonInput {
  name: string;
  phone: string;
  role: Person['role'];
  specialty: string;
  hourlyRate: number;
}

export interface SyncResult {
  propertyId: string;
  name: string;
  ok: boolean;
  at: number;
  count?: number;
  error?: string;
}

export interface DataApi {
  version: number;
  bump: () => void;
  /** true mientras carga el bootstrap inicial del backend. */
  loading: boolean;
  /** Estado de la conexión SSE al backend. */
  connectionStatus: 'connected' | 'reconnecting';
  /** Sesión demo: la UI oculta toda acción de escritura (server rechaza mutaciones). */
  isDemo: boolean;
  /** Recarga inmuebles+reservas del backend. */
  refresh: () => Promise<void>;
  /** Alta de inmueble en el backend. Devuelve el inmueble creado. */
  addProperty: (input: PropertyInput) => Promise<Property | undefined>;
  /** Actualización completa de inmueble en el backend. */
  saveProperty: (id: string, input: PropertyInput) => Promise<Property | undefined>;
  /** Sube una foto real para el inmueble (jpg/png/webp, máx 10 MB). */
  uploadPropertyPhoto: (id: string, file: File) => Promise<Property | undefined>;
  /** Lanza sincronización iCal en el backend. */
  syncNow: () => Promise<SyncResult[]>;
  /** Crea una limpieza (backend valida: NO en fechas ocupadas). 'occupied' si la fecha choca con una estancia. */
  createCleaning: (propertyId: string, date: Date, reservationId?: string, force?: boolean) => Promise<Cleaning | 'occupied' | undefined>;
  /** Edita horas/productos de una limpieza ya confirmada (mantiene estado archivada). */
  updateCleaning: (id: string, workLog: CleaningWorkEntry[], supplies: CleaningSupply[]) => Promise<void>;
  /** Sube una foto a la limpieza; devuelve la lista actualizada. */
  uploadCleaningPhoto: (id: string, file: File) => Promise<string[] | undefined>;
  /** Sustituye la lista de fotos de la limpieza (p. ej. al borrar una). */
  updateCleaningPhotos: (id: string, photos: string[]) => Promise<void>;
  /** Actualiza las instrucciones de ESTA limpieza (snapshot heredado del inmueble;
   *  editar aquí no toca el maestro del inmueble). */
  updateCleaningInstructions: (id: string, instructions: string) => Promise<void>;
  /** Elimina una limpieza no realizada (pendiente/asignada sin horas, productos ni fotos). */
  deleteCleaning: (id: string) => Promise<void>;

  /** Actualiza importe manual y/o notas de una reserva. */
  updateReservation: (id: string, patch: { amount?: number; notes?: string }) => Promise<void>;
  addReservation: (input: {
    propertyId: string;
    guestName: string;
    checkin: string;
    checkout: string;
    guests?: number;
    amount?: number;
  }) => Promise<Reservation>;

  /* Personas (staff) en BD */
  addPerson: (p: PersonInput) => Promise<Person | undefined>;
  savePerson: (id: string, p: PersonInput) => Promise<Person | undefined>;
  deletePerson: (id: string) => Promise<void>;
  /** Genera enlace token; devuelve la ruta /t/<token> (el plano solo se ve una vez). */
  generatePersonToken: (id: string) => Promise<string | undefined>;
  /** Recupera el enlace activo sin regenerarlo; null si no hay (o no es recuperable). */
  getPersonLink: (id: string) => Promise<string | null>;
  revokePersonToken: (id: string) => Promise<void>;
  generateMaintenanceToken: (id: string) => Promise<string | undefined>;
  revokeMaintenanceToken: (id: string) => Promise<void>;

  /* Maestro de categorías de mantenimiento */
  getCategories: () => MaintCategory[];
  saveCategories: (cats: MaintCategory[]) => Promise<void>;
  /** Estado de la última sync por inmueble (del bootstrap). */
  getSyncStatus: () => Record<string, { ok: boolean; at: number; count?: number; error?: string }>;
  /** Config global: margen en días para agendar limpiezas. */
  /** Preferencias persistidas en BD (horarios, umbral batería, limpieza automática). */
  getSettings: () => AppSettings;
  saveSettings: (s: Partial<AppSettings>) => Promise<void>;

  getProperties: () => Property[];
  getProperty: (idOrSlug: string) => Property | undefined;
  getReservations: () => Reservation[];
  getReservationsFor: (propertyId: string) => Reservation[];
  getTedeeAccess: () => TedeeAccess[];
  getLocks: () => Lock[];
  getPeople: () => Person[];
  getPerson: (id: string) => Person | undefined;
  getUsers: () => AppUser[];
  /** Resuelve un usuario de limpieza por su token de acceso (/t/:token). */
  getUserByToken: (token: string) => AppUser | undefined;
  getCleanings: () => Cleaning[];
  getMaintenance: () => MaintenanceTask[];
  getExpenses: () => Expense[];
  getMonthlyFinance: () => MonthlyFinance[];

  /** Ocupación de un inmueble en una fecha (a medio día). */
  getOccupancy: (propertyId: string, date: Date) => OccupancyInfo;
  /** Reserva activa (huésped en casa) en una fecha. */
  getActiveReservation: (propertyId: string, date: Date) => Reservation | undefined;
  /** Coste vivo de una limpieza: horas × €/h + materiales. */
  getCleaningCost: (c: Cleaning) => number;
  getPendingCleanings: () => Cleaning[];
  getUnassignedCleanings: () => Cleaning[];
  getUrgentMaintenance: () => MaintenanceTask[];
  getNotifications: () => Notification[];

  /* Mutaciones mock (patrón version/bump) */
  assignCleaning: (cleaningId: string, personId: string, estimatedHours?: number) => void;
  removeCleaningAssignee: (cleaningId: string, personId: string) => void;
  /** Previsión de horas POR PERSONA de una limpieza asignada. */
  setCleaningEstimate: (cleaningId: string, estimatedHours: number) => void;
  setCleaningStatus: (cleaningId: string, status: Cleaning['status']) => void;
  toggleCleaningCheck: (cleaningId: string, checkId: string) => void;
  addCleaningPhotos: (cleaningId: string, photos: string[]) => void;
  /** Confirma la limpieza: horas reales por persona + productos → pasa a 'archivada'. */
  completeCleaning: (cleaningId: string, workLog: CleaningWorkEntry[], supplies: CleaningSupply[]) => void;
  /** Sustituye el checklist de un inmueble (y de sus limpiezas aún no empezadas). */
  updatePropertyChecklist: (propertyId: string, items: string[]) => void;
  /** Actualiza las instrucciones de limpieza del inmueble (texto largo, distinto del checklist). */
  updatePropertyInstructions: (propertyId: string, text: string) => void;
  addUser: (u: Omit<AppUser, 'id' | 'token'>) => AppUser;
  /** Invalida el enlace de acceso actual. */
  revokeUserToken: (userId: string) => void;
  /** Genera un enlace nuevo (invalida el anterior). Devuelve el token. */
  regenerateUserToken: (userId: string) => string | undefined;
  setMaintenanceStatus: (taskId: string, status: MaintenanceTask['status']) => void;
  assignMaintenance: (taskId: string, personId: string) => void;
  /** Crea una tarea de mantenimiento real (BD). */
  addMaintenance: (t: { propertyId: string; title: string; category: string; expenseTag: string; urgent: boolean; notes: string; checks?: CleaningCheck[] }) => Promise<MaintenanceTask | undefined>;
  /** Edita campos de una tarea existente (título, categoría, etiqueta, urgente, notas, fecha prevista). */
  editMaintenance: (id: string, patch: Partial<{ title: string; category: string; expenseTag: string; urgent: boolean; notes: string; scheduledDate: string | null; checks: CleaningCheck[] }>) => Promise<void>;
  addExpense: (e: Omit<Expense, 'id'>) => void;
}

export const DataContext = createContext<DataApi | null>(null);
