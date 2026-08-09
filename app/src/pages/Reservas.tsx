import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  CalendarRange,
  CalendarX2,
  CheckCircle2,
  ChevronDown,
  Euro,
  MoonStar,
  Plus,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import FilterBar from '@/components/FilterBar';
import KpiCard from '@/components/KpiCard';
import MoneyText from '@/components/MoneyText';
import PersonAvatar from '@/components/PersonAvatar';
import PropertyAvatar from '@/components/PropertyAvatar';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import ReservationDetail from '@/components/cal-res/ReservationDetail';
import { nightsOf } from '@/components/cal-res/calendar-utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import { Toaster } from '@/components/ui/sonner';
import { useData } from '@/data/useData';
import type { Reservation } from '@/data/types';
import { addDays, fmtDateShort, fmtDateShortYear, isSameDay, startOfDay } from '@/lib/format';

/** Fecha de un rango: con año cuando entrada y salida cruzan años (30 dic 2026 → 10 ene 2027) */
const fmtRangeDate = (a: Date, b: Date, d: Date) =>
  a.getFullYear() !== b.getFullYear() ? fmtDateShortYear(d) : fmtDateShort(d);
import { cn } from '@/lib/utils';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

type Cat = 'activa' | 'proxima' | 'completada';

function categoryOf(r: Reservation, today: Date): Cat {
  const t = startOfDay(today).getTime();
  const ci = startOfDay(r.checkIn).getTime();
  const co = startOfDay(r.checkOut).getTime();
  if (r.status === 'completada' || co < t) return 'completada';
  if (ci <= t && t <= co) return 'activa';
  return 'proxima';
}

const STATUS_OPTIONS = [
  { value: 'activas', labelKey: 'res.activas' },
  { value: 'proximas', labelKey: 'res.proximas' },
  { value: 'completadas', labelKey: 'res.completadas' },
];

const inputCls =
  'h-9 w-full rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40';

interface FormState {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  name: string;
  guests: string;
  amount: string;
}

export default function Reservas() {
  const { t } = useTranslation();
  const data = useData();
  const reduce = useReducedMotion();
  const [params, setParams] = useSearchParams();

  const now = new Date();
  const today = startOfDay(now);

  const [loading, setLoading] = useState(true);
  const [painted, setPainted] = useState(false);
  const [localNew, setLocalNew] = useState<Reservation[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  type SortKey = 'guest' | 'property' | 'checkin' | 'checkout' | 'guests' | 'status' | 'amount';
  const [sortKey, setSortKey] = useState<SortKey>('checkin');
  const [sortDesc, setSortDesc] = useState(false);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((v) => !v);
    else {
      setSortKey(key);
      setSortDesc(false);
    }
  };
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const seq = useRef(1);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [form, setForm] = useState<FormState>(() => ({
    propertyId: '',
    checkIn: iso(now),
    checkOut: iso(addDays(now, 3)),
    name: '',
    guests: '2',
    amount: '320',
  }));

  /* Carga inicial: skeletons shimmer */
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(false);
      setTimeout(() => setPainted(true), 350);
    }, 900);
    return () => clearTimeout(t);
  }, []);

  const inmueble = params.get('inmueble') ?? 'todos';
  const tipo = params.get('tipo') ?? 'activas';
  const reservaParam = params.get('reserva');
  const filteredProp = inmueble !== 'todos' ? data.getProperty(inmueble) : undefined;

  const base = useMemo(
    () => [...data.getReservations(), ...localNew],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.version, localNew],
  );

  const activasAhora = base.filter((r) => categoryOf(r, today) === 'activa').length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return base.filter((r) => {
      if (filteredProp && r.propertyId !== filteredProp.id) return false;
      const cat = categoryOf(r, today);
      // "Todos" = activas + próximas; las completadas solo salen con su filtro
      if (tipo === 'todos' && cat === 'completada') return false;
      if (tipo !== 'todos') {
        if (tipo === 'activas' && cat !== 'activa') return false;
        if (tipo === 'proximas' && cat !== 'proxima') return false;
        if (tipo === 'completadas' && cat !== 'completada') return false;
      }
      if (q && !r.guest.name.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, filteredProp?.id, tipo, search]);

  /* Orden por columna; check-in ascendente mantiene "próximas primero desde hoy" */
  const sorted = useMemo(() => {
    const dir = sortDesc ? -1 : 1;
    const valueOf = (r: Reservation): string | number => {
      switch (sortKey) {
        case 'guest': return r.guest.name.toLowerCase();
        case 'property': return (data.getProperty(r.propertyId)?.name ?? '').toLowerCase();
        case 'checkin': return startOfDay(r.checkIn).getTime();
        case 'checkout': return startOfDay(r.checkOut).getTime();
        case 'guests': return r.guestsCount;
        case 'status': return r.status;
        case 'amount': return r.amount;
      }
    };
    const out = [...filtered].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      const cmp =
        typeof va === 'string'
          ? va.localeCompare(vb as string)
          : (va as number) - (vb as number);
      return cmp * dir || a.checkIn.getTime() - b.checkIn.getTime();
    });
    if (sortKey === 'checkin' && !sortDesc) {
      const t0 = today.getTime();
      const rank = (r: Reservation): [number, number] => {
        const ci = startOfDay(r.checkIn).getTime();
        return ci >= t0 ? [0, ci] : [1, -ci];
      };
      out.sort((a, b) => {
        const [ga, ta] = rank(a);
        const [gb, tb] = rank(b);
        return ga - gb || ta - tb;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDesc]);

  /* KPIs de vista (ámbito = inmueble filtrado) */
  const scoped = filteredProp ? base.filter((r) => r.propertyId === filteredProp.id) : base;
  const kpis = useMemo(() => {
    const m = now.getMonth();
    const y = now.getFullYear();
    let nightsMonth = 0;
    let income30 = 0;
    let nightsTotal = 0;
    const in30 = addDays(today, 30).getTime();
    for (const r of scoped) {
      const nights = nightsOf(r);
      nightsTotal += nights;
      const perNight = r.amount / nights;
      for (let n = 0; n < nights; n++) {
        const d = addDays(startOfDay(r.checkIn), n);
        if (d.getMonth() === m && d.getFullYear() === y) nightsMonth++;
        const t = d.getTime();
        if (t >= today.getTime() && t < in30) income30 += perNight;
      }
    }
    return {
      nightsMonth,
      income30: Math.round(income30),
      avgStay: scoped.length ? nightsTotal / scoped.length : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, filteredProp?.id]);

  /* ?reserva=<id>: auto-expandir, resaltar y scroll suave */
  useEffect(() => {
    if (loading || !reservaParam) return;
    if (!sorted.some((r) => r.id === reservaParam)) return;
    setExpandedId(reservaParam);
    const t = setTimeout(() => {
      rowRefs.current.get(reservaParam)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, reservaParam, sorted.length]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const onSync = () => {
    if (syncing) return;
    setSyncing(true);
    data
      .syncNow()
      .then(() => showToast(t('res.syncOk')))
      .catch(() => showToast(t('res.syncError')))
      .finally(() => setSyncing(false));
  };

  const clearFilters = () => {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const saveReservation = () => {
    const prop = data.getProperty(form.propertyId);
    const ci = new Date(`${form.checkIn}T15:00:00`);
    const co = new Date(`${form.checkOut}T11:00:00`);
    if (!prop || !form.name.trim() || Number.isNaN(ci.getTime()) || Number.isNaN(co.getTime()) || co <= ci)
      return;
    const name = form.name.trim();
    const r: Reservation = {
      id: `res-local-${seq.current++}`,
      propertyId: prop.id,
      guest: {
        name,
        country: t('res.entradaManual'),
        initials: name
          .split(' ')
          .map((w) => w[0])
          .slice(0, 2)
          .join('')
          .toUpperCase(),
      },
      checkIn: ci,
      checkOut: co,
      guestsCount: Math.max(1, Math.min(8, Number(form.guests) || 1)),
      guestAges: [],
      status: 'confirmada',
      amount: Math.max(0, Number(form.amount) || 0),
    };
    setLocalNew((prev) => [...prev, r]);
    setFlashId(r.id);
    setExpandedId(r.id);
    setDialogOpen(false);
    setForm((f) => ({ ...f, name: '' }));
    setTimeout(() => {
      rowRefs.current.get(r.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
    setTimeout(() => setFlashId(null), 1400);
    showToast(t('res.reservaCreada'));
  };

  const toggleExpand = (id: string) => setExpandedId((cur) => (cur === id ? null : id));

  const setRowRef = (id: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  };

  const rowMotion = (r: Reservation, i: number) => {
    if (r.id === flashId)
      return {
        initial: { opacity: 0, scale: 0.97 } as const,
        animate: { opacity: 1, scale: 1 } as const,
        transition: { duration: 0.35, ease: EASE_OUT_QUART },
      };
    if (painted || reduce || i >= 6) return { initial: false as const };
    return {
      initial: { opacity: 0, y: 16 } as const,
      animate: { opacity: 1, y: 0 } as const,
      transition: { duration: 0.3, delay: i * 0.025, ease: EASE_OUT_QUART },
    };
  };

  const dateCell = (d: Date, kind: 'in' | 'out') => {
    const isToday = isSameDay(d, now);
    return (
      <span className="flex items-center gap-1.5">
        <span className="font-display tnum text-[13px] font-medium">{fmtDateShort(d)}</span>
        {isToday && (
          <StatusBadge label={kind === 'in' ? t('common.entrada') : t('common.salida')} tone={kind === 'in' ? 'emerald' : 'orange'} />
        )}
      </span>
    );
  };

  /* ---------------------------------------------------------- skeletons */
  const skeletonRows = (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex h-14 animate-pulse items-center gap-3 rounded-xl px-2" style={{ backgroundColor: 'var(--surface-2)' }}>
          <div className="h-8 w-8 rounded-full" style={{ backgroundColor: 'var(--border)' }} />
          <div className="h-3 flex-1 rounded" style={{ backgroundColor: 'var(--border)' }} />
          <div className="h-3 w-16 rounded" style={{ backgroundColor: 'var(--border)' }} />
          <div className="h-3 w-12 rounded" style={{ backgroundColor: 'var(--border)' }} />
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Toaster position="top-center" />
      {/* Topbar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>
            {t('res.reservas', { count: base.length })} · {t('res.activasAhora', { count: activasAhora })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!data.isDemo && (
            <>
              <button
                type="button"
                onClick={onSync}
                className="flex h-9 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
              >
                <motion.span
                  animate={{ rotate: syncing ? 360 : 0 }}
                  transition={{ duration: 0.6, ease: 'easeInOut' }}
                  className="flex"
                >
                  <RefreshCw className="h-4 w-4" />
                </motion.span>
                {syncing ? t('res.sincronizando') : t('res.sincronizar')}
              </button>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="brand-gradient flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                {t('res.nuevaReserva')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* FilterBar + buscador */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar hideAll typeOptions={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: 'var(--text-faint)' }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('res.buscar')}
            className={cn(inputCls, 'w-[190px] pl-9')}
            style={{ borderColor: 'var(--border)' }}
          />
        </div>
        {filteredProp && (
          <button
            type="button"
            onClick={() => {
              const p = new URLSearchParams(params);
              p.delete('inmueble');
              p.delete('reserva');
              setParams(p, { replace: true });
            }}
            className="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-white"
            style={{ backgroundImage: 'linear-gradient(135deg,#6366F1,#8B5CF6)' }}
          >
            {t('res.filtrado', { name: filteredProp.name })} ×
          </button>
        )}
      </div>

      {/* KPIs de vista */}
      <div className="snap-carousel -mx-4 flex gap-3 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
        {(
          [
            <KpiCard key="n" icon={MoonStar} tone="blue" label={t('res.nochesMes')} value={kpis.nightsMonth} />,
            <KpiCard key="i" icon={Euro} tone="emerald" label={t('res.ingresos30')} value={kpis.income30} unit="€" money />,
            <KpiCard key="e" icon={CalendarRange} tone="indigo" label={t('res.estanciaMedia')} value={kpis.avgStay} decimals={1} unit={t('res.noches')} />,
          ] as const
        ).map((card, i) => (
          <motion.div
            key={i}
            initial={painted || reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: i * 0.07, ease: EASE_OUT_QUART }}
            className="h-full w-[46%] min-w-[170px] shrink-0 lg:w-auto lg:min-w-0"
          >
            {card}
          </motion.div>
        ))}
      </div>

      {/* ------------------------------------------------ Desktop: tabla */}
      <div className="card hidden overflow-hidden lg:block">
        {/* Cabecera */}
        <div
          className="grid items-center gap-2 border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
          style={{
            gridTemplateColumns: '1.6fr 1.4fr 1.1fr 1.1fr 0.6fr 0.9fr 0.7fr 28px',
            borderColor: 'var(--border)',
            color: 'var(--text-faint)',
          }}
        >
          {(
            [
              ['guest', t('res.huesped'), false],
              ['property', t('res.inmueble'), false],
              ['checkin', 'Check-in', false],
              ['checkout', 'Check-out', false],
              ['guests', t('res.huespedAbrev'), false],
              ['status', t('res.estado'), false],
              ['amount', t('res.importe'), true],
            ] as const
          ).map(([key, label, right]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleSort(key)}
              className={cn('flex items-center gap-1 uppercase tracking-[0.08em]', right && 'justify-end')}
              style={{ color: sortKey === key ? 'var(--text)' : 'var(--text-faint)' }}
            >
              {label}
              {sortKey === key &&
                (sortDesc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </button>
          ))}
          <span />
        </div>

        {loading ? (
          skeletonRows
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title={t('res.sinReservas')}
            action={
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-[var(--surface-2)]"
                style={{ borderColor: 'var(--border)' }}
              >
                {t('res.limpiarFiltros')}
              </button>
            }
          />
        ) : (
          sorted.map((r, i) => {
            const p = data.getProperty(r.propertyId)!;
            const expanded = expandedId === r.id;
            const highlighted = reservaParam === r.id;
            return (
              <motion.div
                key={r.id}
                ref={setRowRef(r.id)}
                {...rowMotion(r, i)}
                className="border-b last:border-b-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <motion.div
                  animate={{
                    backgroundColor:
                      flashId === r.id
                        ? ['rgb(16 185 129 / 0.12)', 'rgb(16 185 129 / 0)']
                        : 'rgb(16 185 129 / 0)',
                  }}
                  transition={{ duration: 1.2, ease: 'easeOut' }}
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.id)}
                    className="grid h-14 w-full items-center gap-2 px-4 text-left transition-colors duration-150 hover:bg-[var(--surface-2)]"
                    style={{
                      gridTemplateColumns: '1.6fr 1.4fr 1.1fr 1.1fr 0.6fr 0.9fr 0.7fr 28px',
                      boxShadow: highlighted ? 'inset 0 0 0 1.5px #6366F1' : undefined,
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <PersonAvatar name={r.guest.name} initials={r.guest.initials} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{r.guest.name}</span>
                        <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                          {r.guest.country}
                        </span>
                      </span>
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <PropertyAvatar property={p} size={32} />
                      <span className="truncate text-[13px] font-medium">{p.name}</span>
                    </span>
                    {dateCell(r.checkIn, 'in')}
                    {dateCell(r.checkOut, 'out')}
                    <span className="flex items-center gap-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                      <Users className="h-3.5 w-3.5" />
                      <span className="tnum">{r.guestsCount}</span>
                    </span>
                    <span>
                      <StatusBadge label={t(`estadoReserva.${r.status}`)} />
                    </span>
                    <span className="text-right">
                      <MoneyText value={r.amount} className="text-sm text-emerald-500" />
                    </span>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition-transform duration-200',
                        expanded && 'rotate-180',
                      )}
                      style={{ color: 'var(--text-faint)' }}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: EASE_OUT_QUART }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pt-1">
                          <ReservationDetail reservation={r} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* ------------------------------------------------ Móvil: tarjetas */}
      <div className="flex flex-col gap-3 lg:hidden">
        {loading ? (
          skeletonRows
        ) : sorted.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={CalendarX2}
              title={t('res.sinReservas')}
              action={
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-[var(--surface-2)]"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {t('res.limpiarFiltros')}
                </button>
              }
            />
          </div>
        ) : (
          sorted.map((r, i) => {
            const p = data.getProperty(r.propertyId)!;
            const expanded = expandedId === r.id;
            const highlighted = reservaParam === r.id;
            return (
              <motion.div
                key={r.id}
                ref={setRowRef(r.id)}
                {...rowMotion(r, i)}
                className="card p-3.5"
                style={{ boxShadow: highlighted ? '0 0 0 1.5px #6366F1' : undefined }}
              >
                <motion.div
                  animate={{
                    backgroundColor:
                      flashId === r.id
                        ? ['rgb(16 185 129 / 0.12)', 'rgb(16 185 129 / 0)']
                        : 'rgb(16 185 129 / 0)',
                  }}
                  transition={{ duration: 1.2, ease: 'easeOut' }}
                  className="-m-3.5 rounded-2xl p-3.5"
                >
                  <button type="button" onClick={() => toggleExpand(r.id)} className="flex w-full flex-col gap-2.5 text-left">
                    {/* Fila 1: avatar + nombre + guests + estado */}
                    <span className="flex items-center gap-2.5">
                      <PersonAvatar name={r.guest.name} initials={r.guest.initials} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{r.guest.name}</span>
                          <span className="flex shrink-0 items-center gap-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                            <Users className="h-3.5 w-3.5" />
                            <span className="tnum">{r.guestsCount}</span>
                          </span>
                        </span>
                        <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                          {r.guest.country}
                        </span>
                      </span>
                      <StatusBadge label={t(`estadoReserva.${r.status}`)} />
                    </span>
                    {/* Fila 2: inmueble + importe en la misma horizontal */}
                    <span className="flex items-center gap-2">
                      <PropertyAvatar property={p} size={28} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.name}</span>
                      <MoneyText value={r.amount} className="shrink-0 text-sm text-emerald-500" />
                    </span>
                    {/* Fila 3: fechas + noches + peticiones + chevron expand */}
                    <span className="flex items-center gap-1.5 font-display text-[13px] font-medium">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#10B981' }} />
                      {fmtRangeDate(r.checkIn, r.checkOut, r.checkIn)}
                      <span style={{ color: 'var(--text-faint)' }}>→</span>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#F97316' }} />
                      {fmtRangeDate(r.checkIn, r.checkOut, r.checkOut)}
                      <span className="tnum text-xs" style={{ color: 'var(--text-muted)' }}>
                        · {t('cal.noches', { count: nightsOf(r) })}
                      </span>
                      <span className="ml-auto flex items-center gap-1.5">
                        {r.specialRequest && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                            style={{ backgroundColor: 'rgb(245 158 11 / 0.15)', color: '#B45309' }}
                          >
                            {t('res.peticiones')}
                          </span>
                        )}
                        <ChevronDown
                          className={cn('h-4 w-4 transition-transform duration-200', expanded && 'rotate-180')}
                          style={{ color: 'var(--text-faint)' }}
                        />
                      </span>
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: EASE_OUT_QUART }}
                        className="overflow-hidden"
                      >
                        <div className="pt-3">
                          <ReservationDetail reservation={r} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Dialog: nueva reserva (mock) */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">{t('res.nuevaReserva')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              {t('res.inmueble')}
              <Select
                value={form.propertyId}
                onValueChange={(v) => setForm((f) => ({ ...f, propertyId: v }))}
              >
                <SelectTrigger className="h-9 rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm shadow-none">
                  <SelectValue placeholder={t('res.seleccionaInmueble')} />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                  {data.getProperties().map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Check-in
                <input
                  type="date"
                  value={form.checkIn}
                  onChange={(e) => setForm((f) => ({ ...f, checkIn: e.target.value }))}
                  className={inputCls}
                  style={{ borderColor: 'var(--border)' }}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Check-out
                <input
                  type="date"
                  value={form.checkOut}
                  onChange={(e) => setForm((f) => ({ ...f, checkOut: e.target.value }))}
                  className={inputCls}
                  style={{ borderColor: 'var(--border)' }}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              Huésped
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('res.nombreApellidos')}
                className={inputCls}
                style={{ borderColor: 'var(--border)' }}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {t('res.huespedes')}
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={form.guests}
                  onChange={(e) => setForm((f) => ({ ...f, guests: e.target.value }))}
                  className={inputCls}
                  style={{ borderColor: 'var(--border)' }}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {t('res.importeEur')}
                <input
                  type="number"
                  min={0}
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className={inputCls}
                  style={{ borderColor: 'var(--border)' }}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={saveReservation}
              disabled={!form.propertyId || !form.name.trim()}
              className="brand-gradient mt-1 h-10 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            >
              {t('res.guardarReserva')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -8 }}
            transition={{ duration: 0.25, ease: EASE_OUT_QUART }}
            className="fixed left-1/2 top-16 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-overlay lg:bottom-6 lg:left-auto lg:right-6 lg:top-auto lg:translate-x-0"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
