import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import {
  ArrowRight,
  BedDouble,
  Bell,
  CalendarCheck2,
  Euro,
  LogIn,
  LogOut,
  Sparkles,
  Users,
} from 'lucide-react';
import KpiCard from '@/components/KpiCard';
import PropertyCard from '@/components/PropertyCard';
import PropertyAvatar from '@/components/PropertyAvatar';
import EmptyState from '@/components/EmptyState';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { addDays, startOfDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import { cachedUser } from '@/lib/auth';
import type { Property, Reservation } from '@/data/types';
import {
  capitalize,
  fmtDateFull,
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

/** Ingresos prorrateados por noche a partir de las reservas (mismo criterio que Rentabilidad). */
function proratedIncome(reservations: Reservation[], propertyId: string | null, month: number, year: number): number {
  let total = 0;
  for (const r of reservations) {
    if (propertyId && r.propertyId !== propertyId) continue;
    const nights = Math.round((startOfDay(r.checkOut).getTime() - startOfDay(r.checkIn).getTime()) / 86400000);
    if (nights <= 0) continue;
    const perNight = r.amount / nights;
    for (let n = 0; n < nights; n++) {
      const d = addDays(startOfDay(r.checkIn), n);
      if (d.getMonth() === month && d.getFullYear() === year) total += perNight;
    }
  }
  return total;
}

function occupiedNightsMonth(reservations: Reservation[], propertyId: string, month: number, year: number): number {
  let total = 0;
  for (const r of reservations) {
    if (r.propertyId !== propertyId) continue;
    const nights = Math.round((startOfDay(r.checkOut).getTime() - startOfDay(r.checkIn).getTime()) / 86400000);
    for (let n = 0; n < nights; n++) {
      const d = addDays(startOfDay(r.checkIn), n);
      if (d.getMonth() === month && d.getFullYear() === year) total++;
    }
  }
  return total;
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
  const data = useData();
  const [notifOpen, setNotifOpen] = useState(false);
  const [statsProp, setStatsProp] = useState<Property | null>(null);

  // Al abrir el sheet de asignación: previsión por defecto 2 h (o la ya guardada)

  const now = new Date();
  const today = now;
  const hour = now.getHours();
  const greeting = hour >= 6 && hour < 14 ? t('dash.saludoDia') : hour >= 14 && hour < 21 ? t('dash.saludoTarde') : t('dash.saludoNoche');
  const sessionName = cachedUser()?.username ?? '';

  const properties = data.getProperties();
  const reservations = data.getReservations();
  const cleanings = data.getCleanings();
  const maintenance = data.getMaintenance();
  const tedeeAccess = data.getTedeeAccess();
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

  const lookaheadDays = data.getSettings().lookaheadDays;
  const dayStartTs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayTs = dayStartTs(today);
  const windowEndTs = todayTs + lookaheadDays * 86400000;
  const inWindow = (d: Date) => { const t = dayStartTs(d); return t >= todayTs && t <= windowEndTs; };
  const dayDiff = (d: Date) => Math.round((dayStartTs(d) - todayTs) / 86400000);
  const checkInsNext = reservations
    .filter((r) => r.status !== 'completada' && inWindow(r.checkIn))
    .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
  const checkOutsNext = reservations
    .filter((r) => r.status !== 'completada' && inWindow(r.checkOut))
    .sort((a, b) => a.checkOut.getTime() - b.checkOut.getTime());
  const checkInsToday = checkInsNext.filter((r) => isSameDay(r.checkIn, today));
  const cleaningsNext = cleanings.filter((c) => c.status !== 'archivada' && inWindow(c.date));
  const pendingCleanings = data.getPendingCleanings().filter((c) => inWindow(c.date));
  const unassigned = pendingCleanings.filter((c) => c.assigneeIds.length === 0);

  const monthNow = today.getMonth();
  const yearNow = today.getFullYear();
  const expectedMonthIncome = proratedIncome(reservations, null, monthNow, yearNow);
  const monthReservations = reservations.filter(
    (r) => (r.checkIn.getMonth() === monthNow && r.checkIn.getFullYear() === yearNow)
      || (r.checkOut.getMonth() === monthNow && r.checkOut.getFullYear() === yearNow),
  ).length;

  const nextCheckInTime = checkInsToday
    .map((r) => r.checkIn)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const cleaningForReservation = (r: Reservation) =>
    cleanings.find((c) => c.reservationId === r.id);

  const movementRow = (r: Reservation, kind: 'in' | 'out') => {
    const p = data.getProperty(r.propertyId)!;
    const cleaning = kind === 'out' ? cleaningForReservation(r) : undefined;
    const needsAssignment = cleaning && cleaning.assigneeIds.length === 0 && cleaning.status !== 'archivada';
    const date = kind === 'in' ? r.checkIn : r.checkOut;
    const dd = dayDiff(date);
    const isToday = dd === 0;
    const isTomorrow = dd === 1;
    const accent = kind === 'in' ? '#10B981' : '#F97316';
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
          {/* Móvil: nombre en pill de color + guests */}
          <span className="flex items-center gap-1.5 md:hidden">
            <span
              className="truncate rounded-full px-2 py-0.5 text-sm font-semibold"
              style={{ backgroundColor: `${accent}1A`, color: accent }}
            >
              {r.guest.name}
            </span>
            <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold" style={{ color: accent }}>
              <Users className="h-3.5 w-3.5" />
              {r.guestsCount}
            </span>
          </span>
          {/* Desktop: nombre plano + guests muted */}
          <span className="hidden items-center gap-1.5 md:flex">
            <span className="truncate text-sm font-semibold">{r.guest.name}</span>
            <span className="flex shrink-0 items-center gap-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <Users className="h-3.5 w-3.5" />
              {r.guestsCount}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
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
          <span className="flex items-center gap-1.5">
            {/* Chip calendario */}
            <span
              className="flex flex-col items-center justify-center rounded-lg border leading-none"
              style={{ minWidth: '44px', padding: '3px 6px', borderColor: `${accent}40`, backgroundColor: `${accent}14` }}
            >
              <span className="text-xl font-bold" style={{ color: accent }}>
                {date.getDate()}
              </span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: accent }}>
                {fmtMonth(date, true)}
              </span>
            </span>
            {/* Mini-badge Hoy / Mañana */}
            {(isToday || isTomorrow) && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                style={{ backgroundColor: isToday ? '#F43F5E' : '#F97316' }}
              >
                {isToday ? t('dash.hoy') : t('common.manana')}
              </span>
            )}
          </span>
          {/* Desktop: hora pequeña (móvil: oculta) */}
          <span className="hidden text-xs md:block" style={{ color: 'var(--text-muted)' }}>
            {kind === 'in' ? t('common.entrada') : t('common.salida')} {fmtTime(date)}
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
          <p className="font-display text-2xl font-semibold tracking-[-0.02em] lg:text-[28px]">
            {greeting}{sessionName ? `, ${sessionName}` : ''}
          </p>
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
                <button
                  key={n.id}
                  type="button"
                  onClick={() => navigate(n.to)}
                  className="flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                >
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
                </button>
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
              <KpiCard icon={LogIn} tone="emerald" label={t('dash.entradasPeriodo', { days: lookaheadDays })} value={checkInsNext.length} sub={nextCheckInTime ? t('dash.proximaLas', { time: fmtTime(nextCheckInTime) }) : t('dash.sinEntradas')} to="/reservas" className="h-full" />
            </motion.div>,
            <motion.div variants={itemV} key="k3" className="h-full">
              <KpiCard icon={LogOut} tone="orange" label={t('dash.salidasPeriodo', { days: lookaheadDays })} value={checkOutsNext.length} sub={t('dash.limpiezasGeneradas', { count: cleaningsNext.length })} to="/limpieza" className="h-full" />
            </motion.div>,
            <motion.div variants={itemV} key="k4" className="h-full">
              <KpiCard icon={Sparkles} tone="violet" label={t('dash.limpiezasPeriodo', { days: lookaheadDays })} value={pendingCleanings.length} sub={t('dash.sinAsignar', { count: unassigned.length })} to="/limpieza" className="h-full" />
            </motion.div>,
            <motion.div variants={itemV} key="k5" className="h-full">
              <KpiCard icon={Euro} tone="emerald" label={t('dash.ingresosPrevistosMes')} value={expectedMonthIncome} unit="€" money sub={t('dash.reservasMes', { count: monthReservations })} to="/rentabilidad" className="h-full" />
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
            {checkInsNext.length === 0 ? (
              <EmptyState icon={CalendarCheck2} title={t('dash.sinMovimientos')} text={t('dash.sinEntradasTxt', { count: lookaheadDays })} />
            ) : (
              <motion.div variants={rowV} className="flex flex-col">
                {checkInsNext.map((r) => movementRow(r, 'in'))}
              </motion.div>
            )}
          </div>
        </motion.div>
        <motion.div variants={itemV} className="card overflow-hidden">
          <div className="h-[3px] w-full bg-orange-500" />
          <div className="p-4">
            <h2 className="mb-2 font-display text-[17px] font-semibold">{t('dash.salidas')}</h2>
            {checkOutsNext.length === 0 ? (
              <EmptyState icon={CalendarCheck2} title={t('dash.sinMovimientos')} text={t('dash.sinSalidasTxt', { count: lookaheadDays })} />
            ) : (
              <motion.div variants={rowV} className="flex flex-col">
                {checkOutsNext.map((r) => movementRow(r, 'out'))}
              </motion.div>
            )}
          </div>
        </motion.div>
      </motion.section>

      {/* ============================== Sección 3 — Inmuebles */}
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
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {properties.map((p) => (
            <motion.div
              key={p.id}
              variants={itemV}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('a,button')) return;
                setStatsProp(p);
              }}
              className="cursor-pointer"
            >
              <PropertyCard property={p} />
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ============================== Sheet de estadísticas del inmueble */}
      <Sheet open={statsProp !== null} onOpenChange={(o) => !o && setStatsProp(null)}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl border-[var(--border)] bg-[var(--surface)] pb-[calc(24px+env(safe-area-inset-bottom))] lg:inset-y-0 lg:right-0 lg:left-auto lg:h-full lg:w-[420px] lg:rounded-none lg:border-l"
        >
          {statsProp && (() => {
            const income = proratedIncome(reservations, statsProp.id, monthNow, yearNow);
            const nights = occupiedNightsMonth(reservations, statsProp.id, monthNow, yearNow);
            const daysInMonth = new Date(yearNow, monthNow + 1, 0).getDate();
            const occPct = (nights / daysInMonth) * 100;
            const upcoming = reservations.filter((r) => r.propertyId === statsProp.id && r.checkOut >= today && r.status !== 'completada').length;
            const pendClean = cleanings.filter((c) => c.propertyId === statsProp.id && c.status !== 'archivada').length;
            const openMaint = maintenance.filter((m) => m.propertyId === statsProp.id && m.status !== 'finalizada').length;
            const accs = tedeeAccess.filter((a) => a.propertyId === statsProp.id).slice(0, 5);
            const q = `?inmueble=${statsProp.slug}`;
            const links = [
              { to: `/calendario${q}`, label: t('calendario') },
              { to: `/reservas${q}`, label: t('reservas') },
              { to: `/limpieza${q}`, label: t('limpieza') },
              { to: `/mantenimiento${q}`, label: t('mantenimiento') },
              { to: `/rentabilidad${q}`, label: t('rentabilidad') },
            ];
            const rows = [
              { label: t('dash.ingresosPrevistosMes'), value: `${fmtNumber(income)} €`, color: '#10B981' },
              { label: t('dash.ocupacionMes'), value: `${fmtPct(occPct)} · ${t('dash.noches', { count: nights })}`, color: '#3B82F6' },
              { label: t('dash.reservasProximas'), value: String(upcoming), color: '#6366F1' },
              { label: t('dash.limpiezasPendientes'), value: String(pendClean), color: '#8B5CF6' },
              { label: t('dash.reparacionesAbiertas'), value: String(openMaint), color: '#F97316' },
            ];
            return (
              <div className="flex flex-col gap-4">
                <SheetHeader className="pb-0 text-left">
                  <SheetTitle className="font-display text-lg font-semibold">{statsProp.name}</SheetTitle>
                </SheetHeader>
                <div className="card divide-y divide-[var(--border)]">
                  {rows.map((r) => (
                    <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
                      <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                        {r.label}
                      </span>
                      <span className="tnum text-sm font-semibold">{r.value}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
                    {t('dash.accesosRecientes')}
                  </p>
                  {accs.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--text-faint)' }}>{t('dash.sinAccesos')}</p>
                  ) : (
                    <div className="flex flex-col">
                      {accs.map((a) => (
                        <div key={a.id} className="flex items-center justify-between rounded-xl px-2 py-1.5">
                          <span className="truncate text-sm">{t('dash.abrio', { actor: a.actorName, name: statsProp.name })}</span>
                          <span className="ml-2 shrink-0 text-xs" style={{ color: 'var(--text-faint)' }}>{fmtRelative(a.at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {links.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      onClick={() => setStatsProp(null)}
                      className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function fmtDateFullCap(d: Date): string {
  return capitalize(fmtDateFull(d));
}
