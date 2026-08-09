import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import type { Variants } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BedDouble,
  ChevronLeft,
  ChevronRight,
  Euro,
  PieChart as PieChartIcon,
  Plus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import ChartCard from '@/components/ChartCard';
import EmptyState from '@/components/EmptyState';
import MoneyText from '@/components/MoneyText';
import PropertyAvatar from '@/components/PropertyAvatar';
import FinKpiCard from '@/components/fin/FinKpiCard';
import { EXPENSE_META, EXPENSE_TYPES } from '@/components/fin/expenseMeta';
import { Toaster } from '@/components/ui/sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import type { Expense, ExpenseType, Reservation } from '@/data/types';
import {
  addDays,
  capitalize,
  fmtDateShort,
  fmtMoney,
  fmtMonth,
  fmtPct,
  startOfDay,
} from '@/lib/format';
import i18n, { intlLocale } from '@/i18n';
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

type Granularity = 'dia' | 'semana' | 'mes' | 'ano' | 'intervalo';

/** Rango inclusivo [start, end] a precisión de día. */
interface Range {
  start: Date;
  end: Date;
}

const DAY_MS = 86400000;

function mondayOf(d: Date): Date {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() + 6) % 7));
}

function rangeFor(g: Granularity, anchor: Date, desde: string, hasta: string): Range {
  if (g === 'intervalo') {
    const s = desde ? new Date(`${desde}T00:00:00`) : mondayOf(anchor);
    const e = hasta ? new Date(`${hasta}T00:00:00`) : addDays(s, 6);
    return { start: startOfDay(s), end: startOfDay(e) };
  }
  if (g === 'dia') return { start: startOfDay(anchor), end: startOfDay(anchor) };
  if (g === 'semana') {
    const s = mondayOf(anchor);
    return { start: s, end: addDays(s, 6) };
  }
  if (g === 'mes') {
    return {
      start: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
      end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
    };
  }
  return { start: new Date(anchor.getFullYear(), 0, 1), end: new Date(anchor.getFullYear(), 11, 31) };
}

function daysIn(r: Range): number {
  return Math.round((r.end.getTime() - r.start.getTime()) / DAY_MS) + 1;
}

/** Rango inmediatamente anterior de igual longitud (comparativa). */
function prevRangeOf(r: Range): Range {
  const n = daysIn(r);
  return { start: addDays(r.start, -n), end: addDays(r.end, -n) };
}

function shiftAnchor(anchor: Date, g: Granularity, dir: number): Date {
  if (g === 'dia') return addDays(anchor, dir);
  if (g === 'semana') return addDays(anchor, 7 * dir);
  if (g === 'mes') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  if (g === 'ano') return new Date(anchor.getFullYear() + dir, anchor.getMonth(), 1);
  return anchor; // intervalo: sin navegación por chevrons
}

function rangeLabel(r: Range, g: Granularity): string {
  if (g === 'dia') return fmtDateShort(r.start);
  if (g === 'mes') return `${capitalize(fmtMonth(r.start))} ${r.start.getFullYear()}`;
  if (g === 'ano') return String(r.start.getFullYear());
  return `${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}`;
}

/** Ingresos prorrateados por noche dentro del rango (design.md §8, generalizado). */
function incomeInRange(reservations: Reservation[], pid: string | null, r: Range): number {
  let total = 0;
  const rEnd = addDays(r.end, 1).getTime();
  for (const res of reservations) {
    if (pid && res.propertyId !== pid) continue;
    const ci = startOfDay(res.checkIn).getTime();
    const co = startOfDay(res.checkOut).getTime();
    const nights = Math.round((co - ci) / DAY_MS);
    if (nights <= 0) continue;
    const overlap = Math.round((Math.min(co, rEnd) - Math.max(ci, r.start.getTime())) / DAY_MS);
    if (overlap > 0) total += (res.amount / nights) * overlap;
  }
  return total;
}

function occupiedNightsInRange(reservations: Reservation[], pid: string, r: Range): number {
  let total = 0;
  const rEnd = addDays(r.end, 1).getTime();
  for (const res of reservations) {
    if (res.propertyId !== pid) continue;
    const ci = startOfDay(res.checkIn).getTime();
    const co = startOfDay(res.checkOut).getTime();
    const overlap = Math.round((Math.min(co, rEnd) - Math.max(ci, r.start.getTime())) / DAY_MS);
    if (overlap > 0) total += overlap;
  }
  return total;
}

/** Gastos (mensuales) prorrateados por la fracción de su mes cubierta por el rango. */
function expensesInRange(expenses: Expense[], pid: string | null, r: Range): number {
  let total = 0;
  const rEnd = addDays(r.end, 1).getTime();
  for (const e of expenses) {
    if (pid && e.propertyId !== pid) continue;
    const mStart = new Date(e.year, e.month, 1).getTime();
    const mEnd = new Date(e.year, e.month + 1, 1).getTime();
    const overlap = Math.round((Math.min(mEnd, rEnd) - Math.max(mStart, r.start.getTime())) / DAY_MS);
    if (overlap > 0) {
      const monthDays = Math.round((mEnd - mStart) / DAY_MS);
      total += (e.amount * overlap) / monthDays;
    }
  }
  return total;
}

/** Solape en días entre el mes (m,y) y el rango. */
function monthOverlapsRange(month: number, year: number, r: Range): boolean {
  const mStart = new Date(year, month, 1).getTime();
  const mEnd = new Date(year, month + 1, 1).getTime();
  return mStart <= r.end.getTime() && mEnd > r.start.getTime();
}

/** Cubos para las barras: diarios (≤62 días) o mensuales. */
interface Bucket {
  label: string;
  range: Range;
}
function bucketsFor(r: Range): Bucket[] {
  const out: Bucket[] = [];
  if (daysIn(r) <= 62) {
    for (let d = new Date(r.start); d.getTime() <= r.end.getTime(); d = addDays(d, 1)) {
      out.push({ label: fmtDateShort(d), range: { start: d, end: d } });
    }
    return out;
  }
  let cur = new Date(r.start.getFullYear(), r.start.getMonth(), 1);
  while (cur.getTime() <= r.end.getTime()) {
    const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    out.push({ label: capitalize(fmtMonth(cur, true)), range: { start: cur, end: mEnd } });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return out;
}

function delta(cur: number, prev: number): number | undefined {
  if (prev === 0) return undefined;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/* Tooltip del BarChart: mes + Ingresos/Gastos/Neto */
function BarsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
}) {
  if (!active || !payload || payload.length < 2) return null;
  const ingresos = Number(payload[0].value ?? 0);
  const gastos = Number(payload[1].value ?? 0);
  return (
    <div
      className="rounded-xl border px-3 py-2 shadow-overlay"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <p className="mb-1 font-display text-sm font-semibold capitalize">{label}</p>
      <p className="flex items-center gap-2 text-sm">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#10B981' }} />
        <span style={{ color: 'var(--text-muted)' }}>{i18n.t('rent.ingresos')}</span>
        <span className="ml-auto font-display tnum font-medium">{fmtMoney(ingresos)}</span>
      </p>
      <p className="flex items-center gap-2 text-sm">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#F43F5E' }} />
        <span style={{ color: 'var(--text-muted)' }}>{i18n.t('rent.gastos')}</span>
        <span className="ml-auto font-display tnum font-medium">{fmtMoney(gastos)}</span>
      </p>
      <p className="mt-1 flex items-center gap-2 border-t pt-1 text-sm font-semibold" style={{ borderColor: 'var(--border)' }}>
        <span style={{ color: 'var(--text-muted)' }}>{i18n.t('rent.neto')}</span>
        <span className="ml-auto font-display tnum" style={{ color: ingresos - gastos >= 0 ? '#10B981' : '#F43F5E' }}>
          {fmtMoney(ingresos - gastos)}
        </span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ Página */
export default function Rentabilidad() {
  const { t } = useTranslation();
  const data = useData();
  const reduce = useReducedMotion();
  const [params, setParams] = useSearchParams();

  const inmueble = params.get('inmueble') ?? 'todos';
  const g = (params.get('g') as Granularity) || 'mes';
  const anclaParam = params.get('ancla');
  const anchor = anclaParam ? new Date(`${anclaParam}T12:00:00`) : new Date();
  const desde = params.get('desde') ?? '';
  const hasta = params.get('hasta') ?? '';

  const properties = data.getProperties();
  const reservations = data.getReservations();
  const expenses = data.getExpenses();

  const selectedProperty = inmueble === 'todos' ? null : data.getProperty(inmueble) ?? null;
  const propertyId = selectedProperty?.id ?? null;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [activePie, setActivePie] = useState<number>(-1);

  // Formulario alta de gasto
  const [fProperty, setFProperty] = useState<string>('');
  const [fType, setFType] = useState<ExpenseType>('agua');
  const [fAmount, setFAmount] = useState('');
  const [fDate, setFDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fRecurrent, setFRecurrent] = useState(false);
  const [fNote, setFNote] = useState('');

  const range = useMemo(() => rangeFor(g, anchor, desde, hasta), [g, anclaParam, desde, hasta]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevRange = useMemo(() => prevRangeOf(range), [range]);
  const buckets = useMemo(() => bucketsFor(range), [range]);
  const label = rangeLabel(range, g);
  const isEsteMes =
    g === 'mes' &&
    range.start.getMonth() === new Date().getMonth() &&
    range.start.getFullYear() === new Date().getFullYear();

  const setParam = (key: string, value: string, isDefault: boolean) => {
    const next = new URLSearchParams(params);
    if (isDefault) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const setGranularity = (next: Granularity) => {
    const p = new URLSearchParams(params);
    if (next === 'mes') p.delete('g');
    else p.set('g', next);
    if (next !== 'intervalo') {
      p.delete('desde');
      p.delete('hasta');
    }
    setParams(p, { replace: true });
  };
  const navigate = (dir: number) => {
    const next = shiftAnchor(anchor, g, dir);
    // ymd LOCAL (no toISOString: la conversión a UTC desplaza el día)
    const ymd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    setParam('ancla', ymd, false);
  };
  const goEsteMes = () => {
    const p = new URLSearchParams(params);
    p.delete('g');
    p.delete('ancla');
    p.delete('desde');
    p.delete('hasta');
    setParams(p, { replace: true });
  };
  const setIntervalo = (key: 'desde' | 'hasta', value: string) => {
    const p = new URLSearchParams(params);
    p.set('g', 'intervalo');
    if (value) p.set(key, value);
    else p.delete(key);
    setParams(p, { replace: true });
  };

  /* ---------------- Cómputo de ingresos/gastos en el rango ---------------- */
  const ingresos = incomeInRange(reservations, propertyId, range);
  const gastos = expensesInRange(expenses, propertyId, range);
  const neto = ingresos - gastos;
  const ingresosPrev = incomeInRange(reservations, propertyId, prevRange);
  const gastosPrev = expensesInRange(expenses, propertyId, prevRange);
  const netoPrev = ingresosPrev - gastosPrev;

  const nights = propertyId
    ? occupiedNightsInRange(reservations, propertyId, range)
    : properties.reduce((a, p) => a + occupiedNightsInRange(reservations, p.id, range), 0);
  const perNight = nights > 0 ? ingresos / nights : 0;
  const nightsPrev = propertyId
    ? occupiedNightsInRange(reservations, propertyId, prevRange)
    : properties.reduce((a, p) => a + occupiedNightsInRange(reservations, p.id, prevRange), 0);
  const perNightPrev = nightsPrev > 0 ? ingresosPrev / nightsPrev : 0;

  /* ---------------- Barras (cubos diarios o mensuales) ---------------- */
  const bars = buckets.map((b) => ({
    label: b.label,
    ingresos: Math.round(incomeInRange(reservations, propertyId, b.range)),
    gastos: Math.round(expensesInRange(expenses, propertyId, b.range) * 100) / 100,
  }));

  /* ---------------- Quesito ---------------- */
  const byType = EXPENSE_TYPES.map((etype) => ({
    type: etype,
    label: EXPENSE_META[etype].label,
    labelKey: EXPENSE_META[etype].labelKey,
    color: EXPENSE_META[etype].color,
    value: expenses
      .filter(
        (e) =>
          e.type === etype &&
          (!propertyId || e.propertyId === propertyId) &&
          monthOverlapsRange(e.month, e.year, range),
      )
      .reduce((a, e) => {
        const mStart = new Date(e.year, e.month, 1).getTime();
        const mEnd = new Date(e.year, e.month + 1, 1).getTime();
        const overlap = Math.round((Math.min(mEnd, addDays(range.end, 1).getTime()) - Math.max(mStart, range.start.getTime())) / DAY_MS);
        const monthDays = Math.round((mEnd - mStart) / DAY_MS);
        return a + (e.amount * overlap) / monthDays;
      }, 0),
  }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
  const totalByType = byType.reduce((a, x) => a + x.value, 0);

  /* ---------------- Desglose por inmueble ---------------- */
  const periodDays = daysIn(range);
  const breakdown = properties.map((p) => {
    const inc = incomeInRange(reservations, p.id, range);
    const exp = expensesInRange(expenses, p.id, range);
    const n = occupiedNightsInRange(reservations, p.id, range);
    const spark = buckets.slice(-6).map((b) => incomeInRange(reservations, p.id, b.range));
    return {
      property: p,
      occupancy: (n / periodDays) * 100,
      income: inc,
      expenses: exp,
      net: inc - exp,
      perNight: n > 0 ? inc / n : 0,
      spark,
    };
  });

  /* ---------------- Movimientos ---------------- */
  interface Movement {
    id: string;
    kind: 'ingreso' | 'gasto';
    label: string;
    sub: string;
    date: Date;
    amount: number;
    type?: ExpenseType;
  }
  const movements = useMemo(() => {
    const out: Movement[] = [];
    const inRange = (d: Date) => {
      const t = startOfDay(d).getTime();
      return t >= range.start.getTime() && t <= range.end.getTime();
    };
    for (const r of reservations) {
      if (propertyId && r.propertyId !== propertyId) continue;
      if (!inRange(r.checkIn)) continue;
      const p = properties.find((pp) => pp.id === r.propertyId)!;
      out.push({
        id: `mov-res-${r.id}`,
        kind: 'ingreso',
        label: t('rent.reservaDe', { name: r.guest.name }),
        sub: p.name,
        date: r.checkIn,
        amount: r.amount,
      });
    }
    for (const e of expenses) {
      if (propertyId && e.propertyId !== propertyId) continue;
      if (!monthOverlapsRange(e.month, e.year, range)) continue;
      const p = properties.find((pp) => pp.id === e.propertyId)!;
      const now = new Date();
      const date =
        e.month === now.getMonth() && e.year === now.getFullYear()
          ? now
          : new Date(e.year, e.month, 15);
      out.push({
        id: `mov-${e.id}`,
        kind: 'gasto',
        label: e.label,
        sub: p.name,
        date,
        amount: e.amount,
        type: e.type,
      });
    }
    return out.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.version, propertyId, range]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Acciones ---------------- */
  const openDialog = () => {
    setFProperty(propertyId ?? '');
    setFType('agua');
    setFAmount('');
    setFDate(new Date().toISOString().slice(0, 10));
    setFRecurrent(false);
    setFNote('');
    setDialogOpen(true);
  };

  const saveExpense = () => {
    const amount = Number(fAmount.replace(',', '.'));
    const d = new Date(`${fDate}T12:00:00`);
    if (!fProperty || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(d.getTime())) {
      toast.error(t('rent.revisaCampos'));
      return;
    }
    const label = fNote.trim() || t(EXPENSE_META[fType].labelKey);
    data.addExpense({
      propertyId: fProperty,
      type: fType,
      label,
      amount: Math.round(amount * 100) / 100,
      month: d.getMonth(),
      year: d.getFullYear(),
    });
    setDialogOpen(false);
    toast.success(t('rent.gastoAnadido', { amount: fmtMoney(amount) }));
    // El id lo genera el provider; marcamos el último movimiento tras el bump
    setTimeout(() => setLastAddedId('__latest__'), 0);
    setTimeout(() => setLastAddedId(null), 1600);
  };

  const applyPropertyFilter = (slug: string) => {
    setParam('inmueble', slug, false);
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  const noExpenses = byType.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <Toaster position="top-center" />

      {/* ============================== Topbar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={goEsteMes}
          disabled={isEsteMes}
          className={cn(
            'h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-all',
            isEsteMes ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--surface-2)] active:scale-95',
          )}
          style={{ borderColor: 'var(--border)', color: '#6366F1' }}
        >
          {t('rent.esteMes')}
        </button>
        <div className="flex items-center gap-2">
          {!data.isDemo && (
            <>
              <button
                type="button"
                onClick={openDialog}
                className="brand-gradient flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" />
                {t('rent.anadirGasto')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ============================== Filtros */}
      <div className="sticky top-14 z-30 -mx-4 flex flex-wrap items-center gap-2 bg-[var(--bg)]/90 px-4 py-2 backdrop-blur-md lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
        <Select value={inmueble} onValueChange={(v) => setParam('inmueble', v, v === 'todos')}>
          <SelectTrigger className="h-9 w-auto min-w-[180px] gap-2 rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm font-medium shadow-none">
            <SelectValue placeholder={t('rent.general')} />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
            <SelectItem value="todos">{t('rent.general')}</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.slug} value={p.slug}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Selector de periodo estilo Helios: granularidad + navegación + Este mes */}
        <div
          role="tablist"
          aria-label={t('rent.periodAria')}
          className="flex h-9 items-center rounded-full border p-0.5"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          {(['dia', 'semana', 'mes', 'ano', 'intervalo'] as Granularity[]).map((p) => {
            const active = p === g;
            return (
              <button
                key={p}
                role="tab"
                aria-selected={active}
                onClick={() => setGranularity(p)}
                className={cn(
                  'relative flex h-8 items-center rounded-full px-3 text-[13px] font-medium transition-colors',
                  active ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                )}
                style={active ? { backgroundImage: 'linear-gradient(135deg,#6366F1,#8B5CF6)' } : undefined}
              >
                {t(`rent.${p}`)}
              </button>
            );
          })}
        </div>

        {g === 'intervalo' ? (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={desde}
              onChange={(e) => setIntervalo('desde', e.target.value)}
              aria-label={t('rent.desde')}
              className="h-9 rounded-xl border bg-[var(--surface)] px-2 text-[13px] outline-none focus:ring-2 focus:ring-[#6366F1]/40"
              style={{ borderColor: 'var(--border)' }}
            />
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              →
            </span>
            <input
              type="date"
              value={hasta}
              onChange={(e) => setIntervalo('hasta', e.target.value)}
              aria-label={t('rent.hasta')}
              className="h-9 rounded-xl border bg-[var(--surface)] px-2 text-[13px] outline-none focus:ring-2 focus:ring-[#6366F1]/40"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
        ) : (
          <div
            className="flex h-9 items-center gap-0.5 rounded-full border p-0.5"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label={t('rent.prevAria')}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex h-8 min-w-[110px] items-center justify-center px-1">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={label}
                  initial={reduce ? { opacity: 0 } : { y: 12, opacity: 0 }}
                  animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1 }}
                  exit={reduce ? { opacity: 0 } : { y: -12, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="tnum text-[13px] font-semibold"
                >
                  {label}
                </motion.span>
              </AnimatePresence>
            </div>
            <button
              type="button"
              onClick={() => navigate(1)}
              aria-label={t('rent.nextAria')}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* ============================== KPIs */}
      <motion.section
        key={`kpi-${inmueble}-${label}`}
        variants={containerV}
        initial="hidden"
        animate="show"
        className="snap-carousel -mx-4 flex gap-3 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0"
      >
        <motion.div variants={itemV} className="w-[68%] shrink-0 sm:w-[46%] lg:w-auto">
          <FinKpiCard
            icon={TrendingUp}
            tone="emerald"
            label={t('rent.ingresos')}
            value={ingresos}
            unit="€"
            money
            deltaPct={delta(ingresos, ingresosPrev)}
            sub={t('rent.vsPeriodo')}
          />
        </motion.div>
        <motion.div variants={itemV} className="w-[68%] shrink-0 sm:w-[46%] lg:w-auto">
          <FinKpiCard
            icon={TrendingDown}
            tone="rose"
            label={t('rent.gastos')}
            value={gastos}
            unit="€"
            money
            deltaPct={delta(gastos, gastosPrev)}
            deltaGoodWhenUp={false}
            sub={t('rent.vsPeriodo')}
          />
        </motion.div>
        <motion.div variants={itemV} className="w-[68%] shrink-0 sm:w-[46%] lg:w-auto">
          <FinKpiCard
            icon={Euro}
            tone={neto >= 0 ? 'emerald' : 'rose'}
            label={t('rent.beneficio')}
            value={neto}
            unit="€"
            money
            deltaPct={delta(neto, netoPrev)}
            sub={t('rent.vsPeriodo')}
          />
        </motion.div>
        <motion.div variants={itemV} className="w-[68%] shrink-0 sm:w-[46%] lg:w-auto">
          <FinKpiCard
            icon={BedDouble}
            tone="blue"
            label={t('rent.rentPorNoche')}
            value={perNight}
            unit="€"
            decimals={2}
            deltaPct={delta(perNight, perNightPrev)}
            sub={t('rent.nochesOcupadas', { count: nights })}
          />
        </motion.div>
      </motion.section>

      {/* ============================== Barras ingresos vs gastos */}
      <ChartCard
        title={t('rent.ingresosVsGastos')}
        legend={[
          { label: t('rent.ingresos'), color: '#10B981' },
          { label: t('rent.gastos'), color: '#F43F5E' },
        ]}
      >
        <div className="h-[220px] lg:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart key={`${inmueble}-${label}`} data={bars} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'Inter' }}
                dy={6}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'Inter' }}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} k` : `${v}`
                }
              />
              <Tooltip content={<BarsTooltip />} cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }} />
              <Bar
                dataKey="ingresos"
                name={t('rent.ingresos')}
                fill="#10B981"
                radius={[4, 4, 0, 0]}
                isAnimationActive={!reduce}
                animationDuration={600}
                animationEasing="ease-out"
              />
              <Bar
                dataKey="gastos"
                name={t('rent.gastos')}
                fill="#F43F5E"
                radius={[4, 4, 0, 0]}
                isAnimationActive={!reduce}
                animationDuration={600}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* ============================== Quesito + lista */}
      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 font-display text-[17px] font-semibold tracking-[-0.01em]">{t('rent.gastosPorTipo')}</h2>
        {noExpenses ? (
          <EmptyState
            icon={PieChartIcon}
            title={t('rent.sinGastos')}
            text={selectedProperty ? t('rent.sinGastosProp', { name: selectedProperty.name }) : t('rent.sinGastosPeriodo')}
            action={
              !data.isDemo ? (
                <button
                  type="button"
                  onClick={openDialog}
                  className="rounded-xl border px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {t('rent.anadirGasto')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-12">
            <div className="relative mx-auto h-[220px] w-[220px] lg:col-span-5">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byType}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="60%"
                    outerRadius="90%"
                    paddingAngle={2}
                    cornerRadius={6}
                    startAngle={90}
                    endAngle={-270}
                    isAnimationActive={!reduce}
                    animationDuration={700}
                    activeIndex={activePie}
                    activeShape={(props: { cx?: number; cy?: number; innerRadius?: number; outerRadius?: number; startAngle?: number; endAngle?: number; fill?: string }) => (
                      <Sector
                        cx={props.cx}
                        cy={props.cy}
                        innerRadius={props.innerRadius}
                        outerRadius={(props.outerRadius ?? 0) + 6}
                        startAngle={props.startAngle}
                        endAngle={props.endAngle}
                        fill={props.fill}
                        cornerRadius={6}
                      />
                    )}
                    onMouseEnter={(_, i) => setActivePie(i)}
                    onMouseLeave={() => setActivePie(-1)}
                  >
                    {byType.map((x) => (
                      <Cell key={x.type} fill={x.color} stroke="none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <MoneyText value={totalByType} className="text-xl font-bold" />
                <span className="text-[11px] font-medium" style={{ color: 'var(--text-faint)' }}>
                  {t('rent.gastos')}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1 lg:col-span-7">
              {byType.map((x, i) => (
                <div
                  key={x.type}
                  onMouseEnter={() => setActivePie(i)}
                  onMouseLeave={() => setActivePie(-1)}
                  className={cn(
                    'rounded-xl px-3 py-2 transition-colors duration-150',
                    activePie === i && 'bg-[var(--surface-2)]',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: x.color }} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {t(x.labelKey)}
                      {x.type === 'internet' && (
                        <span
                          className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ backgroundColor: 'var(--vi-chip-bg)', color: 'var(--vi-chip-text)' }}
                        >
                          {t('rent.recurrenteMes', { amount: fmtMoney(39.99) })}
                        </span>
                      )}
                    </span>
                    <MoneyText value={x.value} className="text-sm" />
                    <span className="w-12 text-right text-xs font-medium tnum" style={{ color: 'var(--text-faint)' }}>
                      {fmtPct((x.value / totalByType) * 100, 0)}
                    </span>
                  </div>
                  <span className="ml-5 mt-1.5 block h-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--surface-2)' }}>
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ backgroundColor: x.color }}
                      initial={reduce ? { width: `${(x.value / totalByType) * 100}%` } : { width: 0 }}
                      animate={{ width: `${(x.value / totalByType) * 100}%` }}
                      transition={{ delay: 0.15 + i * 0.05, duration: 0.6, ease: EASE_OUT_QUART }}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ============================== Desglose por inmueble */}
      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 font-display text-[17px] font-semibold tracking-[-0.01em]">{t('rent.desglose')}</h2>

        {/* Tabla desktop */}
        <motion.div
          variants={rowV}
          initial="hidden"
          animate="show"
          className="hidden overflow-x-auto md:block"
        >
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
                <th className="pb-2 pr-3 font-semibold">{t('rent.inmueble')}</th>
                <th className="pb-2 pr-3 font-semibold">{t('rent.ocupacion')}</th>
                <th className="pb-2 pr-3 text-right font-semibold">{t('rent.ingresos')}</th>
                <th className="pb-2 pr-3 text-right font-semibold">{t('rent.gastos')}</th>
                <th className="pb-2 pr-3 text-right font-semibold">{t('rent.neto')}</th>
                <th className="pb-2 pr-3 text-right font-semibold">{t('rent.porNoche')}</th>
                <th className="pb-2 text-right font-semibold">{t('rent.tendencia')}</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((b) => (
                <motion.tr
                  key={b.property.id}
                  variants={itemV}
                  onClick={() => applyPropertyFilter(b.property.slug)}
                  className="cursor-pointer border-t transition-colors duration-150 hover:bg-[var(--surface-2)]"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-2.5">
                      <PropertyAvatar property={b.property} size={32} />
                      <span className="font-medium">{b.property.name}</span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-14 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--surface-2)' }}>
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${Math.min(100, b.occupancy)}%`, backgroundColor: '#3B82F6' }}
                        />
                      </span>
                      <span className="tnum text-xs font-medium" style={{ color: '#3B82F6' }}>
                        {fmtPct(b.occupancy, 0)}
                      </span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <MoneyText value={b.income} className="text-sm" />
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <MoneyText value={-b.expenses} signed className="text-sm" />
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <MoneyText value={b.net} signed className="text-sm font-semibold" />
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <span className="font-display tnum text-sm font-medium">{fmtMoney(b.perNight)}</span>
                  </td>
                  <td className="py-2.5">
                    <span className="ml-auto block h-7 w-20">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={b.spark.map((v, i) => ({ i, v }))} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
                          <Bar dataKey="v" fill="#10B981" radius={[2, 2, 0, 0]} isAnimationActive={!reduce} animationDuration={600} />
                        </BarChart>
                      </ResponsiveContainer>
                    </span>
                  </td>
                </motion.tr>
              ))}
              {/* Fila total */}
              <tr className="border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
                <td className="rounded-l-xl py-2.5 pl-2 pr-3 font-display font-semibold">{t('rent.total')}</td>
                <td className="py-2.5 pr-3">
                  <span className="tnum text-xs font-semibold" style={{ color: '#3B82F6' }}>
                    {fmtPct(
                      (properties.reduce((a, p) => a + occupiedNightsInRange(reservations, p.id, range), 0) /
                        (periodDays * properties.length)) *
                        100,
                      0,
                    )}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <MoneyText value={ingresos} className="text-sm font-semibold" />
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <MoneyText value={-gastos} signed className="text-sm font-semibold" />
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <MoneyText value={neto} signed className="text-sm font-semibold" />
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <span className="font-display tnum text-sm font-semibold">{fmtMoney(perNight)}</span>
                </td>
                <td className="rounded-r-xl py-2.5" />
              </tr>
            </tbody>
          </table>
        </motion.div>

        {/* Tarjetas móvil */}
        <motion.div variants={rowV} initial="hidden" animate="show" className="flex flex-col gap-2 md:hidden">
          {breakdown.map((b) => (
            <motion.button
              key={b.property.id}
              variants={itemV}
              type="button"
              onClick={() => applyPropertyFilter(b.property.slug)}
              className="rounded-xl border p-3 text-left transition-colors duration-150 active:bg-[var(--surface-2)]"
              style={{ borderColor: 'var(--border)' }}
            >
              <span className="flex items-center gap-2.5">
                <PropertyAvatar property={b.property} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{b.property.name}</span>
                <span className="tnum text-xs font-medium" style={{ color: '#3B82F6' }}>
                  {fmtPct(b.occupancy, 0)} {t('rent.ocup')}
                </span>
              </span>
              <span className="mt-2 grid grid-cols-3 gap-2 text-center">
                <span>
                  <span className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                    Ingresos
                  </span>
                  <MoneyText value={b.income} className="text-[13px]" />
                </span>
                <span>
                  <span className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                    Gastos
                  </span>
                  <MoneyText value={-b.expenses} signed className="text-[13px]" />
                </span>
                <span>
                  <span className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                    Neto
                  </span>
                  <MoneyText value={b.net} signed className="text-[13px] font-semibold" />
                </span>
              </span>
            </motion.button>
          ))}
        </motion.div>
      </section>

      {/* ============================== Movimientos recientes */}
      <section className="card p-4 sm:p-5">
        <h2 className="mb-2 font-display text-[17px] font-semibold tracking-[-0.01em]">{t('rent.movimientos')}</h2>
        {movements.length === 0 ? (
          <p className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('rent.sinMovimientos')}
          </p>
        ) : (
          <motion.div variants={rowV} initial="hidden" animate="show" className="flex flex-col">
            {movements.map((m, idx) => {
              const flash = lastAddedId === '__latest__' && idx === 0 && m.kind === 'gasto';
              return (
                <motion.div
                  key={m.id}
                  variants={itemV}
                  animate={flash ? { backgroundColor: ['rgb(244 63 94 / 0.1)', 'rgb(244 63 94 / 0)'] } : undefined}
                  transition={flash ? { duration: 1.4 } : undefined}
                  className="flex items-center gap-3 rounded-xl border-b px-2 py-2.5 last:border-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: m.kind === 'ingreso' ? 'var(--em-chip-bg)' : 'var(--ro-chip-bg)',
                    }}
                  >
                    {m.kind === 'ingreso' ? (
                      <ArrowDownLeft className="h-4 w-4" style={{ color: '#10B981' }} />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" style={{ color: '#F43F5E' }} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.label}</span>
                    <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                      {m.sub}
                    </span>
                  </span>
                  {m.type && (
                    <span
                      className="hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold sm:inline"
                      style={{
                        backgroundColor: `${EXPENSE_META[m.type].color}1A`,
                        color: EXPENSE_META[m.type].color,
                      }}
                    >
                      {t(EXPENSE_META[m.type].labelKey)}
                    </span>
                  )}
                  <MoneyText
                    value={m.kind === 'ingreso' ? m.amount : -m.amount}
                    signed
                    className="shrink-0 text-sm"
                  />
                  <span className="w-14 shrink-0 text-right text-xs" style={{ color: 'var(--text-faint)' }}>
                    {fmtDateShort(m.date)}
                  </span>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </section>

      {/* ============================== Dialog alta de gasto */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">{t('rent.anadirGasto')}</DialogTitle>
            <DialogDescription style={{ color: 'var(--text-muted)' }}>
              {t('rent.dialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {t('rent.inmuebleReq')}
              </span>
              <Select value={fProperty} onValueChange={setFProperty}>
                <SelectTrigger className="h-10 rounded-xl border-[var(--border)] bg-[var(--surface)] shadow-none">
                  <SelectValue placeholder={t('rent.seleccionaInmueble')} />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {t('rent.tipo')}
              </span>
              <Select value={fType} onValueChange={(v) => setFType(v as ExpenseType)}>
                <SelectTrigger className="h-10 rounded-xl border-[var(--border)] bg-[var(--surface)] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                  {EXPENSE_TYPES.map((etype) => (
                    <SelectItem key={etype} value={etype}>
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EXPENSE_META[etype].color }} />
                        {t(EXPENSE_META[etype].labelKey)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {t('rent.importeEur')}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="42,50"
                  value={fAmount}
                  onChange={(e) => setFAmount(e.target.value)}
                  className="h-10 rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                  style={{ borderColor: 'var(--border)' }}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {t('rent.fecha')}
                </span>
                <input
                  type="date"
                  value={fDate}
                  onChange={(e) => setFDate(e.target.value)}
                  className="h-10 rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                  style={{ borderColor: 'var(--border)' }}
                />
              </label>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
              <span>
                <span className="block text-sm font-medium">{t('rent.recurrente')}</span>
                {fRecurrent && (
                  <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t('rent.recurrenteDesc')}
                  </span>
                )}
              </span>
              <Switch checked={fRecurrent} onCheckedChange={setFRecurrent} />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {t('rent.nota')}
              </span>
              <input
                type="text"
                placeholder={t('rent.notaPlaceholder')}
                value={fNote}
                onChange={(e) => setFNote(e.target.value)}
                className="h-10 rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                style={{ borderColor: 'var(--border)' }}
              />
            </label>

            <button
              type="button"
              onClick={saveExpense}
              className="brand-gradient mt-1 flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
            >
              {t('rent.guardarGasto')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
