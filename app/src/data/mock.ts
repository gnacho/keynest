/**
 * Generador de datos mock DETERMINISTA (design.md §8).
 * PRNG propio mulberry32 con semilla fija "keynest-42".
 * Fecha base = hoy: el calendario siempre muestra datos vivos.
 */
import type {
  AppUser,
  Cleaning,
  Expense,
  Guest,
  Lock,
  MaintenanceTask,
  MonthlyFinance,
  Person,
  Property,
  Reservation,
  TedeeAccess,
} from './types';
import { addDays, startOfDay, fmtMonth } from '@/lib/format';

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(hashSeed('keynest-42'));

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Día de hoy a las 00:00 (fecha base viva). */
export const TODAY: Date = startOfDay(new Date());

function at(offsetDays: number, hour: number, minute = 0): Date {
  const d = addDays(TODAY, offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/* ---------------------------------------------------------------- Inmuebles */

export const PROPERTIES: Property[] = [
  {
    id: 'p-marina', slug: 'atico-marina', name: 'Ático Marina', address: 'C/ del Mar 14, Valencia', bedrooms: 2, bathrooms: 1, area: 78, photo: '/prop-marina.svg',
    checklist: ['Baño', 'Cocina', 'Sábanas y toallas', 'Reposición', 'Revisar terraza', 'Cerrar toldo', 'Fotos'],
    instructions: 'Entrar por el portal B (2ºB, llave en la caja del tendedero, código 1420). La terraza se limpia SIEMPRE: barrer, pasar la manguera y secar la mesa de fuera; el toldo queda cerrado al terminar. Productos bajo el fregadero; si falta lejía o lavavajillas, anotarlo en productos al confirmar. La vitro pide limpiacristales, no estropajo. Sábanas usadas a la bolsa gris del armario del pasillo y dejarla en el descansillo para lavandería.',
  },
  {
    id: 'p-ruzafa', slug: 'estudio-ruzafa', name: 'Estudio Ruzafa', address: 'C/ Literato Azorín 8', bedrooms: 1, bathrooms: 1, area: 42, photo: '/prop-ruzafa.svg',
    checklist: ['Baño', 'Cocina americana', 'Sábanas y toallas', 'Reposición', 'Regar las plantas', 'Fotos'],
    instructions: 'Estudio pequeño pero con muchas plantas: regarlas con la jarra verde (media jarra por maceta, la del balcón entera). El sofá cama se abre y se revisa entre los cojines. Ojo con la encimera de madera: nada de lejía, solo jabón neutro y secar bien. La llave de la azotea NO hace falta. Dejar la ventana del baño abierta 10 min al terminar para ventilar.',
  },
  {
    id: 'p-carmen', slug: 'duplex-carmen', name: 'Dúplex El Carmen', address: 'C/ Caballeros 22', bedrooms: 3, bathrooms: 2, area: 110, photo: '/prop-carmen.svg',
    checklist: ['Baños (2)', 'Cocina', 'Sábanas y toallas', 'Escalera y barandilla', 'Ceniceros de la terraza', 'Reposición', 'Fotos'],
    instructions: 'Dúplex con escalera de caracol: empezar SIEMPRE por la planta de arriba y bajar. Los dos baños llevan amenities completos (champú, gel y papel de repuesto, en el armario blanco de la escalera). La terraza de arriba tiene ceniceros: vaciarlos y frotar la mesa. La barandilla de la escalera se repasa con paño húmedo. Si hay check-in el mismo día, prioridad a los dormitorios y el baño de arriba.',
  },
  {
    id: 'p-malvarrosa', slug: 'apto-malvarrosa', name: 'Apartamento Malvarrosa', address: 'Av. de la Malvarrosa 57', bedrooms: 2, bathrooms: 1, area: 85, photo: '/prop-malvarrosa.svg',
    checklist: ['Baño', 'Cocina', 'Sábanas y toallas', 'Quitar la arena (suelos y ducha)', 'Reposición', 'Fotos'],
    instructions: 'Al lado de la playa: la ARENA es el enemigo. Barrer antes de fregar (si no, rayas en el parquet), revisar la ducha y el desagüe, y sacudir las alfombras en el balcón. La mampara de la ducha con antical semanal. En verano dejar los dos ventiladores enchufados y orientados a las camas. Productos en el armario del tendedero; la lavadora NO se usa (la ropa va a lavandería).',
  },
  {
    id: 'p-benimaclet', slug: 'loft-benimaclet', name: 'Loft Benimaclet', address: 'C/ Emilio Baró 31', bedrooms: 1, bathrooms: 1, area: 55, photo: '/prop-benimaclet.svg',
    checklist: ['Baño', 'Cocina americana', 'Sábanas y toallas', 'Persianas y claraboya', 'Reposición', 'Fotos'],
    instructions: 'Loft diáfano con claraboya: limpiarla con el palo extensible (está detrás de la puerta) solo si está visiblemente sucia, y NUNCA subiéndose a la cama. Las persianas se bajan y se repasan lamas con el plumero azul. El suelo es microcemento: fregona bien escurrida, sin charcos. Revisar que el aire acondicionado queda apagado y el mando en su soporte de la pared.',
  },
];

const NIGHTLY_PRICE: Record<string, number> = {
  'p-marina': 145,
  'p-ruzafa': 78,
  'p-carmen': 190,
  'p-malvarrosa': 120,
  'p-benimaclet': 95,
};

/* ------------------------------------------------------------------ Personas */

export const PEOPLE: Person[] = [
  { id: 'per-maria', name: 'María Llopis', initials: 'ML', role: 'limpieza', specialty: 'Limpieza general', hourlyRate: 14, phone: '612 345 678' },
  { id: 'per-carla', name: 'Carla Vidal', initials: 'CV', role: 'limpieza', specialty: 'Limpieza a fondo', hourlyRate: 13, phone: '655 902 114' },
  { id: 'per-andres', name: 'Andrés Roca', initials: 'AR', role: 'mantenimiento', specialty: 'Electricidad y cerraduras', hourlyRate: 18, phone: '699 412 887' },
  { id: 'per-pascual', name: 'Pascual Mir', initials: 'PM', role: 'mantenimiento', specialty: 'Fontanería y climatización', hourlyRate: 16, phone: '677 208 431' },
];

/* ------------------------------------------------------------------ Usuarios */

/**
 * Usuarios de la app. Los de limpieza se VINCULAN al maestro de personas
 * vía `personId` (no se duplican): la ficha, €/h y teléfono salen de Personas.
 */
export const USERS: AppUser[] = [
  { id: 'usr-laura', name: 'Laura Ferrer', phone: '600 112 233', role: 'gestion' },
  { id: 'usr-maria', name: 'María Llopis', phone: '612 345 678', role: 'limpieza', token: 'kn-maria-x7q9m2p4w8k3h6z1', personId: 'per-maria' },
  { id: 'usr-carla', name: 'Carla Vidal', phone: '655 902 114', role: 'limpieza', token: 'kn-carla-z3n8v5r1t7y4u2w9', personId: 'per-carla' },
];

/* ------------------------------------------------------------------ Huéspedes */

const GUESTS: Guest[] = [
  { name: 'Sofia Müller', country: 'Alemania', initials: 'SM' },
  { name: "James O'Connor", country: 'Irlanda', initials: 'JO' },
  { name: 'Chloé Dubois', country: 'Francia', initials: 'CD' },
  { name: 'Marco Rossi', country: 'Italia', initials: 'MR' },
  { name: 'Emma Johnson', country: 'EE. UU.', initials: 'EJ' },
  { name: 'Lucas Silva', country: 'Brasil', initials: 'LS' },
  { name: 'Anna Kowalska', country: 'Polonia', initials: 'AK' },
  { name: 'David van Dijk', country: 'Países Bajos', initials: 'DV' },
  { name: 'Ingrid Larsen', country: 'Noruega', initials: 'IL' },
  { name: 'Pierre Martin', country: 'Francia', initials: 'PM' },
  { name: 'Marta Gómez', country: 'España', initials: 'MG' },
  { name: 'Tom Baker', country: 'Reino Unido', initials: 'TB' },
  { name: 'Freya Nielsen', country: 'Dinamarca', initials: 'FN' },
  { name: 'Luca Bianchi', country: 'Italia', initials: 'LB' },
  { name: 'Hannah Schmidt', country: 'Austria', initials: 'HS' },
];

const SPECIAL_REQUESTS = [
  'cuna para bebé',
  'late check-out 14:00',
  'viaja con perro pequeño',
  'alergia al plumón',
];

interface ResSpec {
  propertyId: string;
  inOffset: number;
  nights: number;
  pending?: boolean;
  inHour?: number;
  outHour?: number;
}

const RES_SPECS: ResSpec[] = [
  { propertyId: 'p-marina', inOffset: -6, nights: 6, outHour: 11 }, // salida hoy
  { propertyId: 'p-marina', inOffset: 2, nights: 4, inHour: 16 },
  { propertyId: 'p-marina', inOffset: -20, nights: 4 },
  { propertyId: 'p-ruzafa', inOffset: 0, nights: 4, inHour: 15 }, // entrada hoy 15:00
  { propertyId: 'p-ruzafa', inOffset: -12, nights: 4 },
  { propertyId: 'p-carmen', inOffset: -5, nights: 7 }, // ocupado ahora
  { propertyId: 'p-carmen', inOffset: 5, nights: 4, pending: true }, // nueva reserva
  { propertyId: 'p-carmen', inOffset: -25, nights: 4 },
  { propertyId: 'p-malvarrosa', inOffset: -2, nights: 2, outHour: 11 }, // salida hoy
  { propertyId: 'p-malvarrosa', inOffset: 1, nights: 4, inHour: 15 }, // entrada mañana
  { propertyId: 'p-benimaclet', inOffset: -9, nights: 6 },
  { propertyId: 'p-benimaclet', inOffset: 3, nights: 4, pending: true },
  { propertyId: 'p-malvarrosa', inOffset: -30, nights: 4 },
  { propertyId: 'p-ruzafa', inOffset: -36, nights: 4 },
  { propertyId: 'p-benimaclet', inOffset: -1, nights: 4 }, // ocupado ahora
];

function buildReservations(): Reservation[] {
  return RES_SPECS.map((spec, i) => {
    const guest = GUESTS[i % GUESTS.length];
    const checkIn = at(spec.inOffset, spec.inHour ?? 15);
    const checkOut = at(spec.inOffset + spec.nights, spec.outHour ?? 11);
    const price = NIGHTLY_PRICE[spec.propertyId];
    const amount = Math.round(spec.nights * price * (0.92 + rng() * 0.16));
    const completed = checkOut.getTime() < TODAY.getTime();
    const guestsCount = 1 + Math.floor(rng() * 4);
    const guestAges = Array.from({ length: guestsCount }, () => 4 + Math.floor(rng() * 60));
    const specialRequest = rng() < 0.32 ? pick(SPECIAL_REQUESTS) : undefined;
    return {
      id: `res-${i + 1}`,
      propertyId: spec.propertyId,
      guest,
      checkIn,
      checkOut,
      guestsCount,
      guestAges,
      status: completed ? 'completada' : spec.pending ? 'pendiente' : 'confirmada',
      amount,
      specialRequest,
    };
  });
}

export const RESERVATIONS: Reservation[] = buildReservations();

/* ---------------------------------------------------------------- Cerraduras */

export const LOCKS: Lock[] = [
  { id: 'lock-marina', propertyId: 'p-marina', name: 'Tedee Pro · Marina', battery: 87, online: true, lastSeen: at(0, 9, 12) },
  { id: 'lock-ruzafa', propertyId: 'p-ruzafa', name: 'Tedee Pro · Ruzafa', battery: 64, online: true, lastSeen: at(0, 8, 47) },
  { id: 'lock-carmen', propertyId: 'p-carmen', name: 'Tedee Go · El Carmen', battery: 92, online: true, lastSeen: at(0, 10, 3) },
  { id: 'lock-malvarrosa', propertyId: 'p-malvarrosa', name: 'Tedee Pro · Malvarrosa', battery: 45, online: true, lastSeen: at(0, 7, 58) },
  { id: 'lock-benimaclet', propertyId: 'p-benimaclet', name: 'Tedee Go · Benimaclet', battery: 18, online: false, lastSeen: at(0, Math.max(0, new Date().getHours() - 3), 21) },
];

/* -------------------------------------------------------------- Accesos Tedee */

function buildAccesses(): TedeeAccess[] {
  const actors: { name: string; role: TedeeAccess['actorRole'] }[] = [
    { name: 'Sofia Müller', role: 'huésped' },
    { name: 'Marco Rossi', role: 'huésped' },
    { name: 'Ingrid Larsen', role: 'huésped' },
    { name: 'Emma Johnson', role: 'huésped' },
    { name: 'María Llopis', role: 'limpieza' },
    { name: 'Carla Vidal', role: 'limpieza' },
    { name: 'Laura (tú)', role: 'propietario' },
  ];
  const types: TedeeAccess['type'][] = ['entrada', 'salida', 'remota'];
  const list: TedeeAccess[] = [];
  for (let i = 0; i < 15; i++) {
    // distribuidos en los últimos 7 días, más recientes al final
    const daysAgo = 6 - Math.floor((i / 15) * 7);
    const hour = 8 + Math.floor(rng() * 13);
    const minute = Math.floor(rng() * 60);
    const actor = i === 14 ? actors[4] : pick(actors); // el último: María Llopis
    const prop = PROPERTIES[Math.floor(rng() * PROPERTIES.length)];
    const lock = LOCKS.find((l) => l.propertyId === prop.id)!;
    list.push({
      id: `acc-${i + 1}`,
      at: at(-daysAgo, hour, minute),
      actorName: actor.name,
      actorRole: actor.role,
      type: i === 14 ? 'entrada' : pick(types),
      propertyId: prop.id,
      lockId: lock.id,
    });
  }
  // El más reciente: hoy, hace ~2 h
  const now = new Date();
  list[14].at = new Date(now.getTime() - 2 * 3600 * 1000);
  return list.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export const ACCESSES: TedeeAccess[] = buildAccesses();

/* ------------------------------------------------------------------ Limpiezas */

/** Los checks de cada limpieza se generan del checklist DE SU INMUEBLE. */
function checksFor(propertyId: string, doneUpTo: number) {
  const prop = PROPERTIES.find((p) => p.id === propertyId)!;
  return prop.checklist.map((label, i) => ({
    id: `chk-${i}`,
    label,
    done: i < doneUpTo,
  }));
}

interface CleanSpec {
  propertyId: string;
  dateOffset: number;
  status: Cleaning['status'];
  assigneeIds?: string[];
  estimatedHours?: number;
  workLog?: { personId: string; hours: number }[];
  supplies?: { label: string; amount: number }[];
  checksDone: number;
  photos?: string[];
  reservationIdx?: number;
}

const CLEAN_SPECS: CleanSpec[] = [
  { propertyId: 'p-marina', dateOffset: 0, status: 'pendiente', checksDone: 0, reservationIdx: 0 },
  { propertyId: 'p-malvarrosa', dateOffset: 0, status: 'en-curso', assigneeIds: ['per-maria'], estimatedHours: 2, checksDone: 3, photos: ['/clean-1.svg'], reservationIdx: 8 },
  {
    propertyId: 'p-benimaclet', dateOffset: -3, status: 'archivada', assigneeIds: ['per-maria'], estimatedHours: 2,
    workLog: [{ personId: 'per-maria', hours: 2 }],
    supplies: [{ label: 'Friegasuelos', amount: 3.5 }, { label: 'Bayetas', amount: 1 }],
    checksDone: 6, photos: ['/clean-1.svg', '/clean-2.svg'], reservationIdx: 10,
  },
  {
    propertyId: 'p-ruzafa', dateOffset: -8, status: 'archivada', assigneeIds: ['per-carla'], estimatedHours: 2.5,
    workLog: [{ personId: 'per-carla', hours: 2.5 }],
    supplies: [{ label: 'Limpiacristales', amount: 6.2 }],
    checksDone: 6, photos: ['/clean-3.svg'], reservationIdx: 4,
  },
  {
    propertyId: 'p-marina', dateOffset: -16, status: 'archivada', assigneeIds: ['per-carla'], estimatedHours: 3,
    workLog: [{ personId: 'per-carla', hours: 3 }],
    supplies: [{ label: 'Friegasuelos', amount: 3.5 }, { label: 'Lejía con detergente', amount: 2.4 }, { label: 'Ambientador', amount: 3 }],
    checksDone: 7, photos: ['/clean-2.svg', '/clean-4.svg'], reservationIdx: 2,
  },
  { propertyId: 'p-carmen', dateOffset: 2, status: 'asignada', assigneeIds: ['per-carla'], estimatedHours: 3, checksDone: 0, reservationIdx: 5 },
  { propertyId: 'p-ruzafa', dateOffset: 4, status: 'asignada', assigneeIds: ['per-maria'], estimatedHours: 2, checksDone: 0, reservationIdx: 3 },
];

export const CLEANINGS: Cleaning[] = CLEAN_SPECS.map((s, i) => {
  const supplies = s.supplies?.map((x) => ({ ...x }));
  return {
    id: `clean-${i + 1}`,
    propertyId: s.propertyId,
    reservationId: s.reservationIdx !== undefined ? `res-${s.reservationIdx + 1}` : undefined,
    date: at(s.dateOffset, 11, 30),
    status: s.status,
    assigneeIds: s.assigneeIds ?? [],
    estimatedHours: s.estimatedHours,
    checks: checksFor(s.propertyId, s.checksDone),
    workLog: s.workLog?.map((w) => ({ ...w })),
    supplies,
    materials: supplies?.reduce((acc, x) => acc + x.amount, 0),
    photos: s.photos ?? [],
  };
});

/** Coste calculado en vivo: Σ(horas reales de cada persona × su €/h) + productos (design.md §8). */
export function cleaningCost(c: Cleaning, people: Person[]): number {
  const labor = (c.workLog ?? []).reduce((acc, w) => {
    const rate = people.find((p) => p.id === w.personId)?.hourlyRate ?? 0;
    return acc + w.hours * rate;
  }, 0);
  return labor + (c.materials ?? 0);
}

/* -------------------------------------------------------------- Mantenimiento */

interface MaintSpec {
  propertyId: string;
  title: string;
  category: MaintenanceTask['category'];
  expenseTag: string;
  status: MaintenanceTask['status'];
  urgent?: boolean;
  scheduledOffset?: number;
  assigneeId?: string;
  notes: string;
  cost?: number;
  createdOffset: number;
}

const MAINT_SPECS: MaintSpec[] = [
  { propertyId: 'p-benimaclet', title: 'Cambiar pilas de la cerradura Tedee', category: 'cerradura/pilas', expenseTag: 'pilas', status: 'nueva', urgent: true, scheduledOffset: 2, notes: 'Batería al 18 % y cerradura offline. Ir antes de la próxima entrada.', createdOffset: -1 },
  { propertyId: 'p-marina', title: 'Fuga en el sifón del baño', category: 'fontanería', expenseTag: 'fontanería', status: 'asignada', urgent: true, assigneeId: 'per-pascual', scheduledOffset: 2, notes: 'Goteo bajo el lavabo. Revisar junta y sifón. Aprovechar día desocupado.', createdOffset: -2 },
  { propertyId: 'p-ruzafa', title: 'Sustituir bombillas fundidas del recibidor', category: 'electricidad', expenseTag: 'bombillas', status: 'asignada', assigneeId: 'per-andres', scheduledOffset: 4, notes: 'Dos bombillas E14. Hay repuesto en el armario del tendedero.', createdOffset: -3 },
  { propertyId: 'p-carmen', title: 'El aire acondicionado no enfría', category: 'climatización', expenseTag: 'climatización', status: 'nueva', scheduledOffset: 10, notes: 'Huésped anterior reportó ruido y poca potencia. Revisar gas y filtros.', createdOffset: -1 },
  { propertyId: 'p-malvarrosa', title: 'Reparar pata del sofá', category: 'mobiliario', expenseTag: 'mobiliario', status: 'asignada', assigneeId: 'per-andres', scheduledOffset: 6, notes: 'Pata trasera suelta. Reforzar con escuadras.', createdOffset: -5 },
  { propertyId: 'p-benimaclet', title: 'Persiana del dormitorio atascada', category: 'persianas', expenseTag: 'persianas', status: 'finalizada', assigneeId: 'per-pascual', notes: 'Cinta rota sustituida. Funciona correctamente.', cost: 32, createdOffset: -9 },
  { propertyId: 'p-marina', title: 'Bombillas LED de la terraza', category: 'electricidad', expenseTag: 'bombillas', status: 'finalizada', assigneeId: 'per-andres', notes: 'Sustituidas por LED cálido de bajo consumo.', cost: 18.5, createdOffset: -12 },
  { propertyId: 'p-ruzafa', title: 'Grifo de cocina gotea', category: 'fontanería', expenseTag: 'fontanería', status: 'finalizada', assigneeId: 'per-pascual', notes: 'Cambio de cartucho cerámico.', cost: 24, createdOffset: -14 },
  { propertyId: 'p-carmen', title: 'Pilas mando aire acondicionado', category: 'cerradura/pilas', expenseTag: 'pilas', status: 'nueva', scheduledOffset: 10, notes: 'El mando del split principal apenas responde.', createdOffset: 0 },
];

export const MAINTENANCE: MaintenanceTask[] = MAINT_SPECS.map((s, i) => ({
  id: `maint-${i + 1}`,
  propertyId: s.propertyId,
  title: s.title,
  category: s.category,
  expenseTag: s.expenseTag,
  status: s.status,
  urgent: s.urgent ?? false,
  scheduledDate: s.scheduledOffset !== undefined ? at(s.scheduledOffset, 10) : undefined,
  assigneeId: s.assigneeId,
  notes: s.notes,
  cost: s.cost,
  createdAt: at(s.createdOffset, 9),
}));

/* --------------------------------------------------------------------- Gastos */

function buildExpenses(): Expense[] {
  const list: Expense[] = [];
  const now = new Date();
  let id = 1;
  for (let m = 5; m >= 0; m--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const month = ref.getMonth();
    const year = ref.getFullYear();
    for (const p of PROPERTIES) {
      list.push({ id: `exp-${id++}`, propertyId: p.id, type: 'internet', label: 'Internet fibra', amount: 39.99, month, year });
      list.push({ id: `exp-${id++}`, propertyId: p.id, type: 'agua', label: 'Agua', amount: Math.round((24 + rng() * 30) * 100) / 100, month, year });
      list.push({ id: `exp-${id++}`, propertyId: p.id, type: 'luz', label: 'Electricidad', amount: Math.round((38 + rng() * 52) * 100) / 100, month, year });
      list.push({ id: `exp-${id++}`, propertyId: p.id, type: 'administración', label: 'Administración de finca', amount: 30, month, year });
      if (rng() < 0.45) {
        const extras: [string, number][] = [
          ['Limpieza extra', 35 + rng() * 30],
          ['Reparación menor', 25 + rng() * 60],
          ['Repuestos y consumibles', 12 + rng() * 25],
        ];
        const [label, base] = pick(extras);
        list.push({ id: `exp-${id++}`, propertyId: p.id, type: 'extras', label, amount: Math.round(base * 100) / 100, month, year });
      }
    }
  }
  return list;
}

export const EXPENSES: Expense[] = buildExpenses();

/* ------------------------------------------------ Finanzas mensuales (cómputo) */

/** Ingresos prorrateados por mes a partir de las reservas (design.md §8). */
function incomeForMonth(month: number, year: number): number {
  let total = 0;
  for (const r of RESERVATIONS) {
    const nights = Math.round(
      (startOfDay(r.checkOut).getTime() - startOfDay(r.checkIn).getTime()) / 86400000,
    );
    if (nights <= 0) continue;
    const perNight = r.amount / nights;
    for (let n = 0; n < nights; n++) {
      const d = addDays(startOfDay(r.checkIn), n);
      if (d.getMonth() === month && d.getFullYear() === year) total += perNight;
    }
  }
  return total;
}

function buildMonthlyFinance(): MonthlyFinance[] {
  const now = new Date();
  const out: MonthlyFinance[] = [];
  for (let m = 5; m >= 0; m--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const month = ref.getMonth();
    const year = ref.getFullYear();
    let income = incomeForMonth(month, year);
    if (income === 0 && m > 0) {
      // Meses históricos sin reservas en el mock: baseline determinista
      income = PROPERTIES.reduce(
        (acc, p) => acc + NIGHTLY_PRICE[p.id] * (14 + Math.floor(rng() * 11)),
        0,
      );
    }
    const expenses = EXPENSES.filter((e) => e.month === month && e.year === year).reduce(
      (acc, e) => acc + e.amount,
      0,
    );
    out.push({
      month,
      year,
      label: fmtMonth(ref, true),
      income: Math.round(income),
      expenses: Math.round(expenses * 100) / 100,
    });
  }
  return out;
}

export const MONTHLY_FINANCE: MonthlyFinance[] = buildMonthlyFinance();
