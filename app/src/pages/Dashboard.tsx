import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { animate, motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import {
  ArrowRight,
  BedDouble,
  Bell,
  CalendarCheck2,
  Euro,
  KeyRound,
  LogIn,
  LogOut,
  Smartphone,
  Sparkles,
  Users,
} from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import KpiCard from '@/components/KpiCard';
import PropertyRow from '@/components/PropertyRow';
import PropertyAvatar from '@/components/PropertyAvatar';
import PersonAvatar from '@/components/PersonAvatar';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import MoneyText from '@/components/MoneyText';
import { ChartTooltip } from '@/components/ChartCard';
import HoursStepper from '@/components/tareas/HoursStepper';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import { cachedUser } from '@/lib/auth';
import type { Cleaning, Reservation } from '@/data/types';
import {
  capitalize,
  fmtDateFull,
  fmtDateShort,
  fmtMonth,
  fmtNumber,
  fmtPct,
  fmtRelative,
  fmtTime,
  isSameDay,
} from '@/lib/format';
import { cn } from '@/lib/utils';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

const containerV: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const itemV: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT_QUART } },
};

const rowV: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

/* ------------------------------------------------- Count-up para cifras sueltas */
function CountUp({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    if (reduce) return; // valor final directo, sin count-up
    const c = animate(0, value, { duration: 0.9, ease: EASE_OUT_QUART, onUpdate: setAnimated });
    return () => c.stop();
  }, [value, reduce]);
  const display = reduce ? value : animated;
  return <span className={cn('tnum', className)}>{format(display)}</span>;
}

/* -------------------------------------- Carrusel scroll-snap con indicadores */
function Carousel({ children, itemClassName }: { children: ReactNode[]; itemClassName: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const onScroll = () => {
    const el = ref.current;
    if (!el || el.children.length === 0) return;
    const first = el.children[0] as HTMLElement;
    const step = first.offsetWidth + 12;
    setActive(Math.min(children.length - 1, Math.round(el.scrollLeft / step)));
  };

  return (
    <div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="snap-carousel -mx-4 flex gap-3 overflow-x-auto px-4 lg:mx-0 lg:grid lg:overflow-visible lg:px-0"
        style={{ gridTemplateColumns: `repeat(${children.length}, minmax(0,1fr))`, gap: undefined }}
      >
        {children.map((child, i) => (
          <div key={i} className={cn('shrink-0 lg:w-auto', itemClassName)}>
            {child}
          </div>
        ))}
      </div>
      {children.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5 lg:hidden">
          {children.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all duration-200',
                i === active ? 'brand-gradient w-[18px]' : 'w-1.5',
              )}
              style={i === active ? undefined : { backgroundColor: 'var(--border)' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Página */
export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const data = useData();
  const [notifOpen, setNotifOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Cleaning | null>(null);
  const [sheetHours, setSheetHours] = useState(2);

  // Al abrir el sheet de asignación: previsión por defecto 2 h (o la ya guardada)
  useEffect(() => {
    if (assignTarget) setSheetHours(assignTarget.estimatedHours ?? 2);
  }, [assignTarget]);

  const now = new Date();
  const today = now;
  const hour = now.getHours();
  const greeting = hour >= 6 && hour < 14 ? t('dash.saludoDia') : hour >= 14 && hour < 21 ? t('dash.saludoTarde') : t('dash.saludoNoche');
  const sessionName = cachedUser()?.username ?? '';

  const properties = data.getProperties();
  const reservations = data.getReservations();
  const cleanings = data.getCleanings();
  const accesses = data.getTedeeAccess();
  const locks = data.getLocks();
  const finance = data.getMonthlyFinance();
  const notifications = data.getNotifications();

  /* ---- KPIs computados ---- */
  const occupiedToday = properties.filter((p) => data.getActiveReservation(p.id, today)).length;
  const occupancyPct = properties.length > 0 ? (occupiedToday / properties.length) * 100 : 0;

  const spark14 = useMemo(() => {
    const out: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const count = properties.filter((p) => data.getActiveReservation(p.id, d)).length;
      out.push(properties.length > 0 ? (count / properties.length) * 100 : 0);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.version]);

  const checkInsToday = reservations.filter((r) => isSameDay(r.checkIn, today) && r.status !== 'completada');
  const checkInsTomorrow = reservations.filter((r) => {
    const t = new Date(today);
    t.setDate(t.getDate() + 1);
    return isSameDay(r.checkIn, t);
  });
  const checkOutsToday = reservations.filter((r) => isSameDay(r.checkOut, today) && r.status !== 'completada');
  const cleaningsToday = cleanings.filter((c) => isSameDay(c.date, today));
  const pendingCleanings = data.getPendingCleanings();
  const unassigned = data.getUnassignedCleanings();

  const thisMonth = finance[finance.length - 1] ?? { income: 0, expenses: 0 };
  const prevMonth = finance[finance.length - 2];
  const incomeDelta = prevMonth && prevMonth.income > 0 ? ((thisMonth.income - prevMonth.income) / prevMonth.income) * 100 : undefined;
  const netThis = thisMonth.income - thisMonth.expenses;
  const netPrev = prevMonth ? prevMonth.income - prevMonth.expenses : 0;
  const netDelta = netPrev !== 0 ? ((netThis - netPrev) / Math.abs(netPrev)) * 100 : undefined;

  const nextCheckInTime = checkInsToday
    .map((r) => r.checkIn)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const recentAccesses = accesses.slice(0, 5);
  const problemLock = locks.find((l) => !l.online) ?? locks.find((l) => l.battery < 30);

  const cleaningForReservation = (r: Reservation) =>
    cleanings.find((c) => c.reservationId === r.id);

  const movementRow = (r: Reservation, kind: 'in' | 'out') => {
    const p = data.getProperty(r.propertyId)!;
    const cleaning = kind === 'out' ? cleaningForReservation(r) : undefined;
    const needsAssignment = cleaning && cleaning.assigneeIds.length === 0 && cleaning.status !== 'archivada';
    return (
      <motion.button
        key={r.id}
        variants={itemV}
        type="button"
        onClick={() => navigate(`/reservas?inmueble=${p.slug}&reserva=${r.id}`)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-150 hover:bg-[var(--surface-2)]"
      >
        <PropertyAvatar property={p} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{r.guest.name}</span>
          <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            {p.name}
          </span>
          {needsAssignment && (
            <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-violet-500">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
              {t('dash.limpiezaSinAsignar')}
            </span>
          )}
        </span>
        <span className="flex flex-col items-end gap-1">
          <StatusBadge
            label={`${kind === 'in' ? t('common.entrada') : t('common.salida')} ${fmtTime(kind === 'in' ? r.checkIn : r.checkOut)}`}
            tone={kind === 'in' ? 'emerald' : 'orange'}
          />
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <Users className="h-3.5 w-3.5" />
            {r.guestsCount}
          </span>
        </span>
      </motion.button>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ============================== Topbar */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] lg:text-[28px]">
            {greeting}{sessionName ? `, ${sessionName}` : ''}
          </h1>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {fmtDateFullCap(today)} · {t('dash.inmuebles', { count: properties.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={notifOpen} onOpenChange={setNotifOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t('dash.notificaciones')}
                className="relative flex h-9 w-9 items-center justify-center rounded-xl border transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                <Bell className="h-[18px] w-[18px]" />
                {notifications.length > 0 && (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80 rounded-2xl border-[var(--border)] bg-[var(--surface)] p-2 shadow-overlay"
            >
              <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
                Notificaciones
              </p>
              {notifications.map((n) => (
                <div key={n.id} className="flex items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-[var(--surface-2)]">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: { orange: '#F97316', rose: '#F43F5E', blue: '#3B82F6', emerald: '#10B981', slate: '#64748B', violet: '#8B5CF6', indigo: '#6366F1' }[n.tone] }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-5">{n.text}</p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      {fmtRelative(n.time)}
                    </p>
                  </div>
                </div>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* ============================== Sección 1 — KPIs */}
      <motion.section variants={containerV} initial="hidden" animate="show">
        <Carousel itemClassName="w-[42vw] min-w-[160px]">
          {[
            <motion.div variants={itemV} key="k1" className="h-full">
              <KpiCard icon={BedDouble} tone="blue" label={t('dash.ocupacionActual')} value={occupancyPct} unit="%" spark={spark14} sparkColor="#3B82F6" to="/calendario" className="h-full" />
            </motion.div>,
            <motion.div variants={itemV} key="k2" className="h-full">
              <KpiCard icon={LogIn} tone="emerald" label={t('dash.entradasHoy')} value={checkInsToday.length} sub={nextCheckInTime ? t('dash.proximaLas', { time: fmtTime(nextCheckInTime) }) : t('dash.sinEntradas')} to="/reservas" className="h-full" />
            </motion.div>,
            <motion.div variants={itemV} key="k3" className="h-full">
              <KpiCard icon={LogOut} tone="orange" label={t('dash.salidasHoy')} value={checkOutsToday.length} sub={t('dash.limpiezasGeneradas', { count: cleaningsToday.length })} to="/limpieza" className="h-full" />
            </motion.div>,
            <motion.div variants={itemV} key="k4" className="h-full">
              <KpiCard icon={Sparkles} tone="violet" label={t('dash.limpiezasPendientes')} value={pendingCleanings.length} sub={t('dash.sinAsignar', { count: unassigned.length })} to="/limpieza" className="h-full" />
            </motion.div>,
            <motion.div variants={itemV} key="k5" className="h-full">
              <KpiCard icon={Euro} tone="emerald" label={t('dash.ingresosMes')} value={thisMonth.income} unit="€" money deltaPct={incomeDelta} sub={t('dash.vsMesAnterior')} to="/rentabilidad" className="h-full" />
            </motion.div>,
          ]}
        </Carousel>
      </motion.section>

      {/* ============================== Sección 2 — Hoy: entradas y salidas */}
      <motion.section
        className="grid gap-5 lg:grid-cols-2"
        variants={containerV}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
      >
        <motion.div variants={itemV} className="card overflow-hidden">
          <div className="h-[3px] w-full bg-emerald-500" />
          <div className="p-4">
            <h2 className="mb-2 font-display text-[17px] font-semibold">{t('dash.entradas')}</h2>
            {checkInsToday.length + checkInsTomorrow.length === 0 ? (
              <EmptyState icon={CalendarCheck2} title={t('dash.sinMovimientos')} text={t('dash.sinEntradasTxt')} />
            ) : (
              <motion.div variants={rowV} className="flex flex-col">
                {[...checkInsToday, ...checkInsTomorrow].map((r) => movementRow(r, 'in'))}
              </motion.div>
            )}
          </div>
        </motion.div>
        <motion.div variants={itemV} className="card overflow-hidden">
          <div className="h-[3px] w-full bg-orange-500" />
          <div className="p-4">
            <h2 className="mb-2 font-display text-[17px] font-semibold">{t('dash.salidas')}</h2>
            {checkOutsToday.length === 0 ? (
              <EmptyState icon={CalendarCheck2} title={t('dash.sinMovimientos')} text={t('dash.sinSalidasTxt')} />
            ) : (
              <motion.div variants={rowV} className="flex flex-col">
                {checkOutsToday.map((r) => movementRow(r, 'out'))}
              </motion.div>
            )}
          </div>
        </motion.div>
      </motion.section>

      {/* ============================== Sección 3 — Limpiezas pendientes */}
      <motion.section
        variants={itemV}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
        className="rounded-2xl border p-4 sm:p-5"
        style={{ backgroundColor: 'rgb(139 92 246 / 0.08)', borderColor: 'rgb(139 92 246 / 0.25)' }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-[17px] font-semibold">{t('dash.limpiezasPendientes')}</h2>
            <StatusBadge label={String(pendingCleanings.length)} tone="violet" />
          </div>
          <Link to="/limpieza" className="flex items-center gap-1 text-[13px] font-semibold text-violet-500 hover:underline">
            {t('dash.verLimpieza')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <motion.div variants={rowV} className="flex flex-col gap-1">
          {pendingCleanings.map((c) => {
            const p = data.getProperty(c.propertyId)!;
            const person = c.assigneeIds.length > 0 ? data.getPerson(c.assigneeIds[0]) : undefined;
            const isToday = isSameDay(c.date, today);
            return (
              <motion.div key={c.id} variants={itemV} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--vi-chip-bg)' }}>
                  <Sparkles className="h-4 w-4 text-violet-500" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {isToday ? t('dash.salidaHoy', { time: fmtTime(c.date) }) : t('dash.salidaEl', { date: fmtDateShort(c.date) })}
                  </p>
                </div>
                {person ? (
                  <span className="flex items-center gap-2">
                    <PersonAvatar name={person.name} initials={person.initials} size={28} />
                    <span className="hidden text-xs font-medium sm:block" style={{ color: 'var(--text-muted)' }}>
                      {person.name}
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAssignTarget(c)}
                    className={cn(
                      'rounded-full border border-dashed border-violet-400 px-3 py-1 text-xs font-semibold text-violet-500',
                      !reduce && 'animate-ring-pulse',
                    )}
                  >
                    Asignar
                  </button>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      </motion.section>

      {/* ============================== Sección 4 — Accesos Tedee */}
      <motion.section
        variants={itemV}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
        className="card p-4 sm:p-5"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-display text-[17px] font-semibold">{t('dash.accesosRecientes')}</h2>
          <Link to="/tedee" className="flex items-center gap-1 text-[13px] font-semibold text-[#6366F1] hover:underline">
            {t('dash.verTedee')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {problemLock && (
          <div
            className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium"
            style={
              problemLock.battery < 30
                ? { backgroundColor: 'var(--ro-chip-bg)', color: 'var(--ro-chip-text)' }
                : { backgroundColor: '#FEF3C7', color: '#92400E' }
            }
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {data.getProperty(problemLock.propertyId)!.name}{' '}
            {problemLock.online ? t('dash.bateriaAl', { pct: problemLock.battery }) : t('dash.offlineDesde', { time: fmtRelative(problemLock.lastSeen) })}
          </div>
        )}
        <motion.div variants={rowV} className="flex flex-col">
          {recentAccesses.map((a) => {
            const p = data.getProperty(a.propertyId)!;
            const lock = locks.find((l) => l.id === a.lockId)!;
            const Icon = a.type === 'remota' ? Smartphone : KeyRound;
            const color = a.type === 'entrada' ? '#10B981' : a.type === 'salida' ? '#F97316' : '#3B82F6';
            const bg = a.type === 'entrada' ? 'var(--em-chip-bg)' : a.type === 'salida' ? 'var(--or-chip-bg)' : 'var(--bl-chip-bg)';
            return (
              <motion.div key={a.id} variants={itemV} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: bg }}>
                  <Icon className="h-4 w-4" style={{ color }} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {t('dash.abrio', { actor: a.actorName, name: p.name })}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {fmtRelative(a.at)}
                  </p>
                </div>
                <span
                  className={cn('h-2 w-2 rounded-full', lock.online ? 'bg-emerald-500' : 'border border-slate-400 bg-slate-400/40', lock.online && !reduce && 'animate-dot-pulse')}
                  title={lock.online ? 'Online' : 'Offline'}
                />
              </motion.div>
            );
          })}
        </motion.div>
      </motion.section>

      {/* ============================== Sección 5 — Rentabilidad rápida */}
      <motion.section
        variants={itemV}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
      >
        <button
          type="button"
          onClick={() => navigate('/rentabilidad')}
          className="card grid w-full gap-4 p-4 text-left transition-transform duration-150 hover:-translate-y-0.5 sm:p-5 lg:grid-cols-2"
        >
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-[17px] font-semibold">
              {t('dash.rentabilidadDe', { month: fmtMonth(today) })}
            </h2>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
                  {t('dash.ingresos')}
                </p>
                <CountUp
                  value={thisMonth.income}
                  format={(v) => `${fmtNumber(v)} €`}
                  className="font-display text-2xl font-semibold text-emerald-500"
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
                  {t('dash.gastos')}
                </p>
                <CountUp
                  value={thisMonth.expenses}
                  format={(v) => `${fmtNumber(v)} €`}
                  className="font-display text-2xl font-semibold text-rose-500"
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
                  {t('dash.neto')}
                </p>
                <CountUp
                  value={Math.abs(netThis)}
                  format={(v) => `${fmtNumber(v)} €`}
                  className={cn('font-display text-[28px] font-bold', netThis >= 0 ? 'text-emerald-500' : 'text-rose-500')}
                />
              </div>
            </div>
            {netDelta !== undefined && (
              <p className="text-xs font-semibold" style={{ color: netDelta >= 0 ? '#10B981' : '#F43F5E' }}>
                {netDelta >= 0 ? '↑' : '↓'} {fmtPct(Math.abs(netDelta))} {t('dash.vsMesAnterior')}
              </p>
            )}
          </div>
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={finance} margin={{ top: 4, bottom: 0, left: 0, right: 0 }} barGap={3}>
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--text-faint)' }} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
                <Bar dataKey="income" name={t('dash.ingresos')} fill="#10B981" radius={[4, 4, 0, 0]} isAnimationActive={!reduce} animationBegin={200} animationDuration={600} />
                <Bar dataKey="expenses" name={t('dash.gastos')} fill="#F43F5E" radius={[4, 4, 0, 0]} isAnimationActive={!reduce} animationBegin={200} animationDuration={600} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </button>
      </motion.section>

      {/* ============================== Sección 6 — Tus inmuebles */}
      <motion.section
        variants={containerV}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[17px] font-semibold">{t('dash.tusInmuebles')}</h2>
          <Link to="/ajustes" className="flex items-center gap-1 text-[13px] font-semibold text-[#6366F1] hover:underline">
            {t('dash.gestionar')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {/* Lista compacta: una fila por inmueble (thumb + estado + 4 acciones) */}
        <motion.div variants={itemV} className="card divide-y divide-[var(--border)] py-1">
          {properties.map((p) => (
            <PropertyRow key={p.id} property={p} />
          ))}
        </motion.div>
      </motion.section>

      {/* ============================== Sheet de asignación */}
      <Sheet open={assignTarget !== null} onOpenChange={(o) => !o && setAssignTarget(null)}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl border-[var(--border)] bg-[var(--surface)] pb-[calc(24px+env(safe-area-inset-bottom))] lg:inset-y-0 lg:right-0 lg:left-auto lg:h-full lg:w-[400px] lg:rounded-none lg:border-l"
        >
          <SheetHeader className="pb-3 text-left">
            <SheetTitle className="font-display text-lg font-semibold">{t('dash.asignarLimpieza')}</SheetTitle>
          </SheetHeader>
          {assignTarget && (
            <div className="flex flex-col gap-3">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {data.getProperty(assignTarget.propertyId)!.name} ·{' '}
                {isSameDay(assignTarget.date, today) ? t('dash.hoy') : fmtDateShort(assignTarget.date)}
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  {t('dash.previsionHoras')}
                </span>
                <HoursStepper
                  compact
                  value={sheetHours}
                  onChange={setSheetHours}
                  ariaLabel="previsión de horas"
                />
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {t('dash.horasPorPersona')}
                </span>
              </div>
              {data
                .getPeople()
                .filter((p) => p.role === 'limpieza')
                .map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => {
                      data.assignCleaning(assignTarget.id, person.id, sheetHours);
                      setAssignTarget(null);
                    }}
                    className="flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors duration-150 hover:bg-[var(--surface-2)]"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <PersonAvatar name={person.name} initials={person.initials} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{person.name}</span>
                      <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                        {person.specialty} · <MoneyText value={person.hourlyRate} className="text-xs" />
                        /h
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4" style={{ color: 'var(--text-faint)' }} />
                  </button>
                ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function fmtDateFullCap(d: Date): string {
  return capitalize(fmtDateFull(d));
}
