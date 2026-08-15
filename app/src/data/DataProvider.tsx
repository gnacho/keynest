import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import i18n, { applyLanguage } from '@/i18n';
import { api } from '@/lib/api';
import { fetchMe, isAuthed } from '@/lib/auth';
import { DataContext } from './data-context';
import type { AppSettings, DataApi, OccupancyInfo, PropertyInput, SyncResult } from './data-context';
import type {
  AppUser,
  Cleaning,
  CleaningCheck,
  CleaningSupply,
  CleaningWorkEntry,
  Expense,
  Lock,
  MaintenanceTask,
  MaintCategory,
  MonthlyFinance,
  Notification,
  Person,
  Property,
  Reservation,
  TedeeAccess,
} from './types';
import { addDays, isSameDay, startOfDay } from '@/lib/format';

/* -------------------------------------------------- mapeos API → dominio */
interface ApiProperty {
  id: string; slug: string; name: string; address: string; bedrooms: number; bathrooms: number; area: number;
  photo: string; ical_url: string; checklist: string[]; instructions: string; owner_id?: string | null;
}
interface ApiReservation {
  id: string; property_id: string; uid: string; checkin: string; checkout: string;
  summary: string; confirmation_code: string; phone_last4: string;
  amount?: number; notes?: string; guest_name?: string; booked_date?: string;
  guests?: number | null;
}

function mapProperty(row: ApiProperty): Property {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    address: row.address,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms ?? 1,
    area: row.area,
    photo: row.photo,
    checklist: row.checklist ?? [],
    instructions: row.instructions ?? '',
    icalUrl: row.ical_url ?? '',
    ownerId: row.owner_id ?? null,
  };
}

function mapReservation(row: ApiReservation): Reservation {
  const [y1, m1, d1] = row.checkin.split('-').map(Number);
  const [y2, m2, d2] = row.checkout.split('-').map(Number);
  const checkIn = new Date(y1, m1 - 1, d1, 15, 0);
  const checkOut = new Date(y2, m2 - 1, d2, 11, 0);
  const code = row.confirmation_code || '';
  const realName = (row.guest_name || '').trim();
  const name = realName || (code ? `Airbnb · ${code}` : 'Airbnb');
  const initials = realName
    ? realName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : (code || 'AB').slice(0, 2);
  return {
    id: row.id,
    propertyId: row.property_id,
    guest: {
      name,
      country: '',
      initials,
    },
    checkIn,
    checkOut,
    guestsCount: row.guests ?? 2,
    guestAges: [],
    status: checkOut.getTime() < Date.now() ? 'completada' : checkIn.getTime() <= Date.now() ? 'activa' : 'confirmada',
    amount: row.amount ?? 0,
    notes: row.notes ?? '',
    bookedDate: row.booked_date || '',
  };
}

/** Token de acceso para personal de limpieza: kn-<slug>-<16 caracteres aleatorios> (crypto, no Math.random). */
function genToken(name: string, seq: number): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/[^a-z]/g, '');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const rand = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `kn-${slug || 'user'}-${rand}${seq.toString(36)}`;
}

function cleaningCost(c: Cleaning, people: Person[]): number {
  const hours = (c.workLog ?? []).reduce((acc, w) => {
    const p = people.find((x) => x.id === w.personId);
    return acc + w.hours * (p?.hourlyRate ?? 0);
  }, 0);
  return hours + (c.materials ?? 0);
}

interface ApiMaintenance {
  id: string; property_id: string; title: string; category: string; expense_tag: string;
  urgent: number; notes: string; status: MaintenanceTask['status']; assignee_id: string | null;
  assigned_user_id: string | null; scheduled_date: string | null; cost: number | null; created_at: number;
  checks?: CleaningCheck[] | string; photos?: string[] | string; has_token?: boolean;
}

function mapMaintenance(row: ApiMaintenance): MaintenanceTask {
  const parseArr = <T,>(v: T[] | string | undefined): T[] =>
    Array.isArray(v) ? v : JSON.parse(v || '[]') as T[];
  return {
    id: row.id,
    propertyId: row.property_id,
    title: row.title,
    category: row.category as MaintenanceTask['category'],
    expenseTag: row.expense_tag,
    urgent: Boolean(row.urgent),
    notes: row.notes,
    status: row.status,
    assigneeId: row.assignee_id ?? undefined,
    assignedUserId: row.assigned_user_id ?? undefined,
    scheduledDate: row.scheduled_date ? new Date(`${row.scheduled_date}T12:00:00`) : undefined,
    cost: row.cost ?? undefined,
    checks: parseArr<CleaningCheck>(row.checks),
    photos: parseArr<string>(row.photos),
    hasToken: Boolean(row.has_token),
    createdAt: new Date(row.created_at),
  };
}

interface ApiPerson {
  id: string; name: string; phone: string; role: 'limpieza' | 'proveedor';
  specialty: string; hourly_rate: number; has_token?: boolean; created_at: number;
}

function mapPerson(row: ApiPerson): Person {
  const initials = row.name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return {
    id: row.id,
    name: row.name,
    initials,
    role: row.role,
    specialty: row.specialty,
    hourlyRate: row.hourly_rate,
    phone: row.phone,
    hasToken: Boolean(row.has_token),
  };
}

interface ApiCleaning {
  id: string; property_id: string; reservation_id: string | null; date: string;
  status: Cleaning['status']; assignee_ids: string; estimated_hours: number;
  checks: { id: string; label: string; done: boolean }[] | string;
  instructions?: string | null;
  photos: string[] | string; created_at: number;
  work_log?: { personId: string; hours: number }[] | string | null;
  supplies?: { label: string; amount: number }[] | string | null;
  materials?: number | null;
}

interface ApiTedeeLock {
  id: number; name: string; battery: number; online: boolean;
  rssi: number | null; state: number | null; jammed: boolean;
  serial: string; propertyId: string;
}

interface ApiTedeeAccess {
  id: string; at: string; actorName: string;
  actorRole: TedeeAccess['actorRole']; type: TedeeAccess['type'];
  propertyId: string; lockId: string;
}

function mapLock(row: ApiTedeeLock): Lock {
  return {
    id: String(row.id),
    propertyId: row.propertyId ?? '',
    name: row.name,
    battery: row.battery ?? 0,
    online: Boolean(row.online),
    lastSeen: new Date(),
  };
}

function mapAccess(row: ApiTedeeAccess): TedeeAccess {
  return {
    id: row.id,
    at: new Date(row.at),
    actorName: row.actorName ?? '',
    actorRole: row.actorRole,
    type: row.type,
    propertyId: row.propertyId ?? '',
    lockId: row.lockId,
  };
}

interface BootstrapData {
  properties: ApiProperty[];
  reservations: ApiReservation[];
  cleanings: ApiCleaning[];
  maintenance: ApiMaintenance[];
  people: ApiPerson[];
  expenses?: ApiExpense[];
  categories: MaintCategory[];
  config?: { checkInTime?: string; checkOutTime?: string; batteryThreshold?: number; autoCleaning?: boolean; lookaheadDays?: number; nDays?: number; dismissedNotifs?: string[] };
  sync: Record<string, { ok: boolean; at: number; count?: number; error?: string }>;
  users?: AppUser[];
  demo?: boolean;
  demoEnabled?: boolean;
  locks?: ApiTedeeLock[];
  accesses?: ApiTedeeAccess[];
}

function mapCleaning(row: ApiCleaning): Cleaning {
  const [y, m, d] = row.date.split('-').map(Number);
  const parseJson = <T,>(v: T | string, fallback: T): T => {
    if (typeof v !== 'string') return v ?? fallback;
    try { return JSON.parse(v) as T; } catch { return fallback; }
  };
  return {
    id: row.id,
    propertyId: row.property_id,
    reservationId: row.reservation_id ?? undefined,
    date: new Date(y, m - 1, d, 11, 30),
    status: row.status,
    assigneeIds: parseJson<string[]>(row.assignee_ids, []),
    estimatedHours: row.estimated_hours,
    checks: parseJson(row.checks, []),
    instructions: row.instructions ?? '',
    workLog: parseJson(row.work_log ?? undefined, undefined as unknown as Cleaning['workLog']),
    supplies: parseJson(row.supplies ?? undefined, undefined as unknown as Cleaning['supplies']),
    materials: row.materials ?? undefined,
    photos: parseJson<string[]>(row.photos, []),
  };
}

interface ApiExpense {
  id: string; property_id: string; type: Expense['type']; label: string;
  amount: number; month: number; year: number; created_at: number;
}

function mapExpense(row: ApiExpense): Expense {
  return {
    id: row.id,
    propertyId: row.property_id,
    type: row.type,
    label: row.label,
    amount: row.amount,
    month: row.month,
    year: row.year,
  };
}

/**
 * Provider síncrono con patrón version/bump, hidratado del backend real.
 * Solo inmuebles y reservas vienen de la API; el resto de entidades
 * (limpiezas, mantenimiento, gastos, personas, Tedee) arrancan vacías.
 */
export default function DataProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(() => isAuthed());
  const [isDemo, setIsDemo] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting'>('connected');
  const bump = () => setVersion((v) => v + 1);

  const properties = useRef<Property[]>([]);
  const reservations = useRef<Reservation[]>([]);
  const syncMap = useRef<BootstrapData['sync']>({});
  // Entidades con backend real; se hidratan en refresh()
  const cleanings = useRef<Cleaning[]>([]);
  const maintenance = useRef<MaintenanceTask[]>([]);
  const expenses = useRef<Expense[]>([]);
  const people = useRef<Person[]>([]);
  const users = useRef<AppUser[]>([]);
  const categories = useRef<MaintCategory[]>([]);
  const settings = useRef<AppSettings>({ checkInTime: '15:00', checkOutTime: '11:00', batteryThreshold: 30, autoCleaning: true, lookaheadDays: 7, nDays: 7, dismissedNotifs: [] });
  const locks = useRef<Lock[]>([]);
  const accesses = useRef<TedeeAccess[]>([]);
  const monthlyFinance = useRef<MonthlyFinance[]>([]);
  const userSeq = useRef(1);

  const refresh = useCallback(async () => {
    if (!isAuthed()) {
      setLoading(false);
      return;
    }
    try {
      const user = await fetchMe();
      if (user?.language) applyLanguage(user.language);
      const data = await api<BootstrapData>('/api/bootstrap');
      properties.current = data.properties.map(mapProperty);
      reservations.current = data.reservations.map(mapReservation);
      cleanings.current = (data.cleanings ?? []).map(mapCleaning);
      people.current = (data.people ?? []).map(mapPerson);
      expenses.current = (data.expenses ?? []).map(mapExpense);
      maintenance.current = (data.maintenance ?? []).map(mapMaintenance);
      categories.current = data.categories ?? [];
      settings.current = {
        checkInTime: data.config?.checkInTime ?? '15:00',
        checkOutTime: data.config?.checkOutTime ?? '11:00',
        batteryThreshold: data.config?.batteryThreshold ?? 30,
        autoCleaning: data.config?.autoCleaning ?? true,
        lookaheadDays: data.config?.lookaheadDays ?? 7,
        nDays: data.config?.nDays ?? 7,
        dismissedNotifs: data.config?.dismissedNotifs ?? [],
      };
      syncMap.current = data.sync ?? {};
      users.current = data.users ?? [];
      locks.current = (data.locks ?? []).map(mapLock);
      accesses.current = (data.accesses ?? []).map(mapAccess);
      setIsDemo(Boolean(data.demo));
      bump();
    } catch {
      /* 401 → evento global; otros errores se reintentan en el próximo refresh */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onAuthed = () => {
      setLoading(true);
      void refresh();
    };
    window.addEventListener('keynest-authed', onAuthed);
    return () => window.removeEventListener('keynest-authed', onAuthed);
  }, [refresh]);

  /* SSE (contrato api-stack): eventos nombrados <dominio>.changed → refetch
     con debounce; sync.resync (reconexión con eventos perdidos) → refetch
     inmediato. EventSource reintenta solo y manda Last-Event-ID. */
  const sseTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!isAuthed()) return;
    let es: EventSource | null = null;
    let disposed = false;

    const scheduleRefresh = () => {
      if (disposed) return;
      if (sseTimer.current !== null) window.clearTimeout(sseTimer.current);
      sseTimer.current = window.setTimeout(() => {
        sseTimer.current = null;
        void refresh();
      }, 250);
    };

    es = new EventSource('/api/events');
    es.addEventListener('open', () => setConnectionStatus('connected'));
    es.addEventListener('error', () => setConnectionStatus('reconnecting'));
    es.addEventListener('property.changed', scheduleRefresh);
    es.addEventListener('reservation.changed', scheduleRefresh);
    es.addEventListener('cleaning.changed', scheduleRefresh);
    es.addEventListener('expense.changed', scheduleRefresh);
    es.addEventListener('maintenance.changed', scheduleRefresh);
    es.addEventListener('person.changed', scheduleRefresh);
    es.addEventListener('user.changed', scheduleRefresh);
    es.addEventListener('settings.changed', scheduleRefresh);
    es.addEventListener('sync.resync', () => {
      if (disposed) return;
      void refresh();
    });

    const onUnauthorized = () => { es?.close(); es = null; };
    window.addEventListener('keynest-unauthorized', onUnauthorized);

    return () => {
      disposed = true;
      if (sseTimer.current !== null) window.clearTimeout(sseTimer.current);
      window.removeEventListener('keynest-unauthorized', onUnauthorized);
      es?.close();
    };
  }, [refresh]);

  const saveProperty = useCallback(
    async (id: string, input: PropertyInput) => {
      const res = await api<{ property: ApiProperty }>(`/api/properties/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      const mapped = mapProperty(res.property);
      const idx = properties.current.findIndex((p) => p.id === id);
      if (idx >= 0) properties.current[idx] = mapped;
      bump();
      return mapped;
    },
    [],
  );

  const api2 = useMemo<DataApi>(() => {
    const getActiveReservation = (propertyId: string, date: Date): Reservation | undefined => {
      const d = startOfDay(date).getTime();
      return reservations.current.find(
        (r) =>
          r.propertyId === propertyId &&
          startOfDay(r.checkIn).getTime() <= d &&
          d <= startOfDay(r.checkOut).getTime(),
      );
    };

    const putMaintenance = async (taskId: string, patch: Record<string, unknown>) => {
      try {
        const res = await api<{ task: ApiMaintenance }>(`/api/maintenance/${taskId}`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        });
        const mapped = mapMaintenance(res.task);
        const idx = maintenance.current.findIndex((x) => x.id === taskId);
        if (idx >= 0) maintenance.current[idx] = mapped;
        bump();
      } catch {
        /* próximo refresh re-sincroniza */
      }
    };

    const putCleaning = async (cleaningId: string, patch: Record<string, unknown>) => {
      try {
        const res = await api<{ cleaning: ApiCleaning }>(`/api/cleanings/${cleaningId}`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        });
        const mapped = mapCleaning(res.cleaning);
        const idx = cleanings.current.findIndex((x) => x.id === cleaningId);
        if (idx >= 0) cleanings.current[idx] = mapped;
        bump();
      } catch {
        /* el próximo refresh re-sincroniza */
      }
    };

    const getOccupancy = (propertyId: string, date: Date): OccupancyInfo => {
      const active = getActiveReservation(propertyId, date);
      if (active) return { occupied: true, reservation: active };
      const past = reservations.current
        .filter((r) => r.propertyId === propertyId && r.checkOut.getTime() <= date.getTime())
        .sort((a, b) => b.checkOut.getTime() - a.checkOut.getTime())[0];
      return { occupied: false, freeSince: past?.checkOut };
    };

    return {
      version,
      bump,
      loading,
      connectionStatus,
      isDemo,
      refresh,
      addProperty: async (input) => {
        const res = await api<{ property: ApiProperty }>('/api/properties', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        const mapped = mapProperty(res.property);
        properties.current = [...properties.current, mapped];
        bump();
        return mapped;
      },
      saveProperty,
      uploadPropertyPhoto: async (id, file) => {
        const fd = new FormData();
        fd.append('photo', file);
        const res = await fetch(`/api/properties/${id}/photo`, {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        if (!res.ok) return undefined;
        const data = (await res.json()) as { property: ApiProperty };
        const mapped = mapProperty(data.property);
        const idx = properties.current.findIndex((p) => p.id === id);
        if (idx >= 0) properties.current[idx] = mapped;
        bump();
        return mapped;
      },
      updateReservation: async (id, patch) => {
        const res = await api<{ reservation: ApiReservation }>(`/api/reservations/${id}`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        });
        const mapped = mapReservation(res.reservation);
        const idx = reservations.current.findIndex((r) => r.id === id);
        if (idx >= 0) reservations.current[idx] = mapped;
        bump();
      },
      addReservation: async (input: {
        propertyId: string;
        guestName: string;
        checkin: string;
        checkout: string;
        guests?: number;
        amount?: number;
      }) => {
        const res = await api<{ reservation: ApiReservation }>('/api/reservations', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        const mapped = mapReservation(res.reservation);
        reservations.current = [...reservations.current, mapped];
        bump();
        return mapped;
      },
      addPerson: async (input) => {
        const res = await api<{ person: ApiPerson }>('/api/people', { method: 'POST', body: JSON.stringify(input) });
        const mapped = mapPerson(res.person);
        people.current = [...people.current, mapped];
        bump();
        return mapped;
      },
      savePerson: async (id, input) => {
        const res = await api<{ person: ApiPerson }>(`/api/people/${id}`, { method: 'PUT', body: JSON.stringify(input) });
        const mapped = mapPerson(res.person);
        const idx = people.current.findIndex((p) => p.id === id);
        if (idx >= 0) people.current[idx] = mapped;
        bump();
        return mapped;
      },
      deletePerson: async (id) => {
        await api(`/api/people/${id}`, { method: 'DELETE' });
        people.current = people.current.filter((p) => p.id !== id);
        bump();
      },
      generatePersonToken: async (id) => {
        const res = await api<{ path: string }>(`/api/people/${id}/token`, { method: 'POST' });
        const idx = people.current.findIndex((p) => p.id === id);
        if (idx >= 0) people.current[idx] = { ...people.current[idx], hasToken: true };
        bump();
        return res.path;
      },
      getPersonLink: async (id) => {
        const res = await api<{ path: string | null }>(`/api/people/${id}/token`);
        return res.path;
      },
      revokePersonToken: async (id) => {
        await api(`/api/people/${id}/token`, { method: 'DELETE' });
        const idx = people.current.findIndex((p) => p.id === id);
        if (idx >= 0) people.current[idx] = { ...people.current[idx], hasToken: false };
        bump();
      },
      generateMaintenanceToken: async (id) => {
        const res = await api<{ path: string }>(`/api/maintenance/${id}/token`, { method: 'POST' });
        const idx = maintenance.current.findIndex((t) => t.id === id);
        if (idx >= 0) maintenance.current[idx] = { ...maintenance.current[idx], hasToken: true };
        bump();
        return res.path;
      },
      revokeMaintenanceToken: async (id) => {
        await api(`/api/maintenance/${id}/token`, { method: 'DELETE' });
        const idx = maintenance.current.findIndex((t) => t.id === id);
        if (idx >= 0) maintenance.current[idx] = { ...maintenance.current[idx], hasToken: false };
        bump();
      },
      getSettings: () => settings.current,
      saveSettings: async (patch) => {
        // lookaheadDays es preferencia POR USUARIO (perfil); el resto es global admin
        const { lookaheadDays, ...globalPatch } = patch;
        if (lookaheadDays !== undefined) {
          await api('/api/auth/profile', { method: 'PUT', body: JSON.stringify({ lookaheadDays }) });
        }
        if (Object.keys(globalPatch).length > 0) {
          await api('/api/config/settings', { method: 'PUT', body: JSON.stringify(globalPatch) });
        }
        settings.current = { ...settings.current, ...patch };
        bump();
      },
      getCategories: () => categories.current,
      saveCategories: async (cats) => {
        await api('/api/config/categories', { method: 'PUT', body: JSON.stringify({ categories: cats }) });
        categories.current = cats;
        bump();
      },
      updateCleaning: async (id, workLog, supplies) => {
        await putCleaning(id, { workLog, supplies });
      },
      uploadCleaningPhoto: async (id, file) => {
        const fd = new FormData();
        fd.append('photo', file);
        const res = await fetch(`/api/cleanings/${id}/photo`, {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        if (!res.ok) return undefined;
        const d = (await res.json()) as { cleaning: ApiCleaning };
        const mapped = mapCleaning(d.cleaning);
        const idx = cleanings.current.findIndex((x) => x.id === id);
        if (idx >= 0) cleanings.current[idx] = mapped;
        bump();
        return mapped.photos;
      },
      updateCleaningPhotos: async (id, photos) => {
        await putCleaning(id, { photos });
      },
      updateCleaningInstructions: async (id, instructions) => {
        await putCleaning(id, { instructions });
      },
      deleteCleaning: async (id) => {
        await api(`/api/cleanings/${id}`, { method: 'DELETE' });
        cleanings.current = cleanings.current.filter((c) => c.id !== id);
        bump();
      },
      createCleaning: async (propertyId, date, reservationId, force = false) => {
        const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const res = await fetch('/api/cleanings', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId, date: ymd, reservationId, force }),
        });
        if (res.status === 409) {
          const body = (await res.json().catch(() => ({}))) as { code?: string };
          return body.code === 'occupied' ? 'occupied' : undefined;
        }
        if (!res.ok) return undefined;
        await refresh();
        const data = (await res.json()) as { cleaning: ApiCleaning };
        return mapCleaning(data.cleaning);
      },
      syncNow: async () => {
        const res = await api<{ results: SyncResult[] }>('/api/sync', { method: 'POST' });
        for (const r of res.results) {
          syncMap.current = {
            ...syncMap.current,
            [r.propertyId]: { ok: r.ok, at: r.at, count: r.count, error: r.error },
          };
        }
        await refresh();
        return res.results;
      },
      getSyncStatus: () => syncMap.current,
      getProperties: () => properties.current,
      getProperty: (idOrSlug) =>
        properties.current.find((p) => p.id === idOrSlug || p.slug === idOrSlug),
      getReservations: () => reservations.current,
      getReservationsFor: (propertyId) => reservations.current.filter((r) => r.propertyId === propertyId),
      getTedeeAccess: () => accesses.current,
      getLocks: () => locks.current,
      getPeople: () => people.current,
      getPerson: (id) => people.current.find((p) => p.id === id),
      getUsers: () => users.current,
      getUserByToken: (token) => users.current.find((u) => u.token !== undefined && u.token === token),
      getCleanings: () => cleanings.current,
      getMaintenance: () => maintenance.current,
      getExpenses: () => expenses.current,
      getMonthlyFinance: () => monthlyFinance.current,
      getOccupancy,
      getActiveReservation,
      getCleaningCost: (c) => cleaningCost(c, people.current),
      getPendingCleanings: () => cleanings.current.filter((c) => c.status !== 'archivada'),
      getUnassignedCleanings: () =>
        cleanings.current.filter((c) => c.status !== 'archivada' && c.assigneeIds.length === 0),
      getUrgentMaintenance: () =>
        maintenance.current.filter((t) => t.urgent && t.status !== 'finalizada'),
      getNotifications: (): Notification[] => {
        const out: Notification[] = [];
        const today = startOfDay(new Date());
        const todayOut = reservations.current.filter(
          (r) => isSameDay(r.checkOut, today) && r.status !== 'completada',
        );
        for (const r of todayOut) {
          const p = properties.current.find((pp) => pp.id === r.propertyId);
          if (!p) continue;
          out.push({
            id: `not-out-${r.id}`,
            text: i18n.t('notif.salidaHoy', { name: p.name }),
            time: r.checkOut,
            tone: 'orange',
            to: `/reservas?reserva=${r.id}`,
          });
        }
        for (const l of locks.current.filter((x) => x.battery < 30 || !x.online)) {
          const p = properties.current.find((pp) => pp.id === l.propertyId);
          if (!p) continue;
          out.push({
            id: `not-lock-${l.id}`,
            text: i18n.t('notif.bateriaBaja', { name: p.name, pct: l.battery }),
            time: l.lastSeen,
            tone: 'rose',
            to: `/tedee?lock=${l.id}`,
          });
        }
        const newest = reservations.current
          .filter((r) => r.status !== 'completada')
          .sort((a, b) => b.checkIn.getTime() - a.checkIn.getTime())[0];
        if (newest) {
          const p = properties.current.find((pp) => pp.id === newest.propertyId);
          if (p) {
            out.push({
              id: `not-new-${newest.id}`,
              text: i18n.t('notif.nuevaReserva', { name: p.name }),
              time: addDays(today, -1),
              tone: 'blue',
              to: `/reservas?reserva=${newest.id}`,
            });
          }
        }
        return out.slice(0, 5);
      },

      assignCleaning: (cleaningId, personId, estimatedHours) => {
        const c = cleanings.current.find((x) => x.id === cleaningId);
        if (c && !c.assigneeIds.includes(personId) && c.assigneeIds.length < 2) {
          const assigneeIds = [...c.assigneeIds, personId];
          const status = c.status === 'pendiente' ? 'asignada' : c.status;
          void putCleaning(cleaningId, { assigneeIds, estimatedHours: estimatedHours ?? c.estimatedHours ?? 2, status });
        }
      },
      removeCleaningAssignee: (cleaningId, personId) => {
        const c = cleanings.current.find((x) => x.id === cleaningId);
        if (c) {
          const assigneeIds = c.assigneeIds.filter((id) => id !== personId);
          const status = assigneeIds.length === 0 && c.status === 'asignada' ? 'pendiente' : c.status;
          void putCleaning(cleaningId, { assigneeIds, status });
        }
      },
      setCleaningEstimate: (cleaningId, estimatedHours) => {
        void putCleaning(cleaningId, { estimatedHours });
      },
      setCleaningStatus: (cleaningId, status) => {
        void putCleaning(cleaningId, { status });
      },
      toggleCleaningCheck: (cleaningId, checkId) => {
        const c = cleanings.current.find((x) => x.id === cleaningId);
        if (!c) return;
        const checks = c.checks.map((k) => (k.id === checkId ? { ...k, done: !k.done } : k));
        void putCleaning(cleaningId, { checks });
      },
      addCleaningPhotos: (cleaningId, photos) => {
        const c = cleanings.current.find((x) => x.id === cleaningId);
        if (c) void putCleaning(cleaningId, { photos: [...c.photos, ...photos] });
      },
      completeCleaning: (cleaningId, workLog: CleaningWorkEntry[], supplies: CleaningSupply[]) => {
        const c = cleanings.current.find((x) => x.id === cleaningId);
        if (!c) return;
        void putCleaning(cleaningId, {
          status: 'archivada',
          workLog,
          supplies,
          checks: c.checks.map((k) => ({ ...k, done: true })),
        });
      },
      updatePropertyChecklist: (propertyId, items) => {
        const p = properties.current.find((x) => x.id === propertyId);
        if (!p) return;
        void saveProperty(propertyId, {
          name: p.name,
          address: p.address,
          bedrooms: p.bedrooms,
          bathrooms: p.bathrooms,
          area: p.area,
          photo: p.photo,
          icalUrl: p.icalUrl ?? '',
          checklist: items,
          instructions: p.instructions,
        });
      },
      updatePropertyInstructions: (propertyId, text) => {
        const p = properties.current.find((x) => x.id === propertyId);
        if (!p) return;
        void saveProperty(propertyId, {
          name: p.name,
          address: p.address,
          bedrooms: p.bedrooms,
          bathrooms: p.bathrooms,
          area: p.area,
          photo: p.photo,
          icalUrl: p.icalUrl ?? '',
          checklist: p.checklist,
          instructions: text,
        });
      },
      addUser: (u) => {
        const seq = userSeq.current++;
        const user: AppUser = {
          ...u,
          id: `usr-nuevo-${seq}`,
          token: u.role === 'limpieza' ? genToken(u.name, seq) : undefined,
        };
        users.current = [...users.current, user];
        bump();
        return user;
      },
      revokeUserToken: (userId) => {
        const u = users.current.find((x) => x.id === userId);
        if (u) {
          u.token = undefined;
          bump();
        }
      },
      regenerateUserToken: (userId) => {
        const u = users.current.find((x) => x.id === userId);
        if (!u) return undefined;
        u.token = genToken(u.name, userSeq.current++);
        bump();
        return u.token;
      },
      setMaintenanceStatus: (taskId, status) => {
        void putMaintenance(taskId, { status });
      },
      assignMaintenance: (taskId, personId) => {
        const t = maintenance.current.find((x) => x.id === taskId);
        void putMaintenance(taskId, { assigneeId: personId, status: t && t.status === 'nueva' ? 'asignada' : undefined });
      },
      assignUserToMaintenance: (taskId, userId) => {
        const t = maintenance.current.find((x) => x.id === taskId);
        void putMaintenance(taskId, { assignedUserId: userId, status: t && t.status === 'nueva' ? 'asignada' : undefined });
      },
      editMaintenance: async (id, patch) => {
        await putMaintenance(id, patch);
      },
      deleteMaintenance: async (id) => {
        await api(`/api/maintenance/${id}`, { method: 'DELETE' });
        maintenance.current = maintenance.current.filter((t) => t.id !== id);
        bump();
      },
      addMaintenance: async (input) => {
        const res = await api<{ task: ApiMaintenance }>('/api/maintenance', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        const mapped = mapMaintenance(res.task);
        maintenance.current = [mapped, ...maintenance.current];
        bump();
        return mapped;
      },
      addExpense: async (input) => {
        const res = await api<{ expense: ApiExpense }>('/api/expenses', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        const mapped = mapExpense(res.expense);
        expenses.current = [mapped, ...expenses.current];
        bump();
        return mapped;
      },
      updateExpense: async (id, patch) => {
        const res = await api<{ expense: ApiExpense }>(`/api/expenses/${id}`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        });
        const mapped = mapExpense(res.expense);
        expenses.current = expenses.current.map((e) => (e.id === id ? mapped : e));
        bump();
      },
      deleteExpense: async (id) => {
        await api(`/api/expenses/${id}`, { method: 'DELETE' });
        expenses.current = expenses.current.filter((e) => e.id !== id);
        bump();
      },
    };
  }, [version, loading, connectionStatus, refresh, saveProperty, isDemo]);

  return (
    <DataContext.Provider value={api2}>
      {loading ? (
        <div
          className="flex min-h-[100dvh] items-center justify-center"
          style={{ backgroundColor: 'var(--bg)' }}
        >
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#6366F1]/30 border-t-[#6366F1]" />
        </div>
      ) : (
        children
      )}
    </DataContext.Provider>
  );
}
