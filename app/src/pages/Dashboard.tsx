import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import {
  BedDouble,
  Calendar,
  CalendarCheck2,
  CalendarRange,
  CircleAlert,
  Euro,
  Lock,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react';
import MovementsCard from '@/components/MovementsCard';
import MonthOverviewCard from '@/components/MonthOverviewCard';
import PropertyCard from '@/components/PropertyCard';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import PropertyAvatar from '@/components/PropertyAvatar';
import EmptyState from '@/components/EmptyState';
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

/* ------------------------------------------------------------------ Página */
export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const data = useData();
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
  const pendingCleanings = data.getPendingCleanings().filter((c) => inWindow(c.date));
  const unassigned = pendingCleanings.filter((c) => c.assigneeIds.length === 0);

  // Entradas que coinciden con una salida el mismo día en el mismo inmueble (rotación).
  const sameDayCheckIns = checkInsNext.filter((r) =>
    reservations.some(
      (x) =>
        x.propertyId === r.propertyId
        && x.id !== r.id
        && isSameDay(x.checkOut, r.checkIn),
    ),
  ).length;

  const monthNow = today.getMonth();
  const yearNow = today.getFullYear();
  const expectedMonthIncome = proratedIncome(reservations, null, monthNow, yearNow);
  const monthReservations = reservations.filter(
    (r) => (r.checkIn.getMonth() === monthNow && r.checkIn.getFullYear() === yearNow)
      || (r.checkOut.getMonth() === monthNow && r.checkOut.getFullYear() === yearNow),
  ).length;


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
    // Rotación: entrada y salida el mismo día en el mismo inmueble → limpieza sin margen.
    const rotacion = reservations.some(
      (x) =>
        x.propertyId === r.propertyId
        && x.status !== 'completada'
        && (kind === 'in' ? isSameDay(x.checkOut, date) : isSameDay(x.checkIn, date)),
    );
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
        <span className="flex items-center gap-1.5">
          {/* CircleAlert si rotación (izquierda, alineado) */}
          {rotacion && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex shrink-0">
                  <CircleAlert className="h-4 w-4" style={{ color: '#F43F5E' }} aria-label={t('dash.rotacion')} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('dash.rotacion')}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Chip Entrada/Salida con hora — oculto en móvil (el color de la tarjeta ya distingue) */}
          <span
            className="hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline-flex"
            style={{ backgroundColor: 'var(--sl-chip-bg)', color: 'var(--sl-chip-text)' }}
          >
            {kind === 'in' ? t('common.entrada') : t('common.salida')} {fmtTime(date)}
          </span>
          {/* Chip fecha: día + mes */}
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
      </motion.button>
    );
  };

  return (
    <div className="flex flex-col gap-5">
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
        </div>
      </div>

      {/* ============================== Sección 1 — KPIs */}
      <motion.section className="grid gap-5 sm:grid-cols-2" variants={containerV} initial="hidden" animate="show">
        <motion.div variants={itemV} className="h-full">
          <MovementsCard
            checkIns={checkInsNext.length}
            checkOuts={checkOutsNext.length}
            cleanings={pendingCleanings.length}
            unassigned={unassigned.length}
            sameDayCheckIns={sameDayCheckIns}
            lookaheadDays={lookaheadDays}
            className="h-full"
          />
        </motion.div>
        <motion.div variants={itemV} className="h-full">
          <MonthOverviewCard
            occupancyPct={occupancyPct}
            spark={spark14}
            income={expectedMonthIncome}
            reservationsCount={monthReservations}
            className="h-full"
          />
        </motion.div>
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
          className="max-h-[85dvh] overflow-y-auto rounded-t-3xl border-[var(--border)] bg-[var(--surface)] pb-[calc(24px+env(safe-area-inset-bottom))] lg:inset-x-auto lg:inset-y-auto lg:top-1/2 lg:left-1/2 lg:h-auto lg:max-h-[85vh] lg:w-[720px] lg:max-w-[calc(100vw-32px)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-2xl lg:border lg:shadow-overlay"
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
              { to: `/calendario${q}`, label: t('nav.calendario'), icon: Calendar },
              { to: `/reservas${q}`, label: t('nav.reservas'), icon: CalendarRange },
              { to: `/limpieza${q}`, label: t('nav.limpieza'), icon: Sparkles },
              { to: `/mantenimiento${q}`, label: t('nav.mantenimiento'), icon: Wrench },
              { to: `/rentabilidad${q}`, label: t('nav.rentabilidad'), icon: Euro },
              { to: `/tedee${q}`, label: t('nav.tedee'), icon: Lock },
            ];
            const rows = [
              { label: t('dash.ingresosPrevistosMes'), value: `${fmtNumber(income)} €`, color: '#10B981', icon: Euro },
              { label: t('dash.ocupacionMes'), value: `${fmtPct(occPct)}`, sub: t('dash.noches', { count: nights }), color: '#3B82F6', icon: BedDouble },
              { label: t('dash.reservasProximas'), value: String(upcoming), color: '#6366F1', icon: CalendarCheck2 },
              { label: t('dash.limpiezasPendientes'), value: String(pendClean), color: '#8B5CF6', icon: Sparkles },
              { label: t('dash.reparacionesAbiertas'), value: String(openMaint), color: '#F97316', icon: Wrench },
            ];
            return (
              <div className="flex flex-col gap-5 px-5 pb-5">
                <SheetHeader className="px-0 pb-0 pt-1 text-left">
                  <div className="flex items-center gap-3">
                    <PropertyAvatar property={statsProp} size={44} />
                    <div className="min-w-0">
                      <SheetTitle className="font-display text-lg font-semibold">{statsProp.name}</SheetTitle>
                      {statsProp.address && (
                        <p className="truncate text-[13px]" style={{ color: 'var(--text-muted)' }}>{statsProp.address}</p>
                      )}
                    </div>
                  </div>
                </SheetHeader>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {rows.map(({ icon: RowIcon, label, value, sub, color }) => (
                    <div key={label} className="card flex items-center justify-between gap-2 px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}1A` }}>
                          <RowIcon className="h-4 w-4" style={{ color }} strokeWidth={2} />
                        </span>
                        <span className="truncate">{label}</span>
                      </span>
                      <span className="shrink-0 tnum text-sm font-semibold">
                        {value}
                        {sub && <span className="ml-1 text-xs font-medium" style={{ color: 'var(--text-faint)' }}>{sub}</span>}
                      </span>
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

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {links.map(({ icon: LinkIcon, to, label }) => (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setStatsProp(null)}
                      className="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-all duration-150 hover:brightness-105 active:scale-[0.98]"
                      style={{
                        borderColor: 'var(--border)',
                        backgroundColor: 'var(--surface-2)',
                        color: 'var(--text)',
                      }}
                    >
                      <LinkIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} style={{ color: 'var(--brand-from)' }} />
                      {label}
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
