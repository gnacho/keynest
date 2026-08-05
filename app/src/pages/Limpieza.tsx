import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Clock, Euro, Plus, Sparkles, UserRoundX } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import KpiCard from '@/components/KpiCard';
import CleaningCard from '@/components/tareas/CleaningCard';
import ToastHost from '@/components/tareas/toast';
import { useToasts } from '@/components/tareas/use-toasts';
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
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import type { CleaningStatus } from '@/data/types';
import { fmtMoney, isSameDay } from '@/lib/format';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

const containerV: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const itemV: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT_QUART } },
};

const STATUS_OPTIONS = [
  { value: 'pendiente', labelKey: 'limp.pendientesF' },
  { value: 'asignada', labelKey: 'limp.asignadasF' },
  { value: 'archivada', labelKey: 'limp.archivadasF' },
];

export default function Limpieza() {
  const { t } = useTranslation();
  const data = useData();
  const reduce = useReducedMotion();
  const { toasts, push } = useToasts();
  const [params] = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);

  const inmueble = params.get('inmueble') ?? 'todos';
  const estado = params.get('estado') ?? 'todos';
  const tareaParam = params.get('tarea');

  const all = data.getCleanings();
  const now = new Date();

  /* ---- KPIs computados ---- */
  const pendientesHoy = all.filter((c) => isSameDay(c.date, now) && c.status !== 'archivada').length;
  const sinAsignar = all.filter((c) => c.status !== 'archivada' && c.assigneeIds.length === 0).length;
  const monthDone = all.filter(
    (c) =>
      c.status === 'archivada' &&
      c.date.getMonth() === now.getMonth() &&
      c.date.getFullYear() === now.getFullYear(),
  );
  const horasMes = monthDone.reduce(
    (acc, c) => acc + (c.workLog ?? []).reduce((a, w) => a + w.hours, 0),
    0,
  );
  const costeMes = monthDone.reduce((acc, c) => acc + data.getCleaningCost(c), 0);

  const pendientes = all.filter((c) => c.status === 'pendiente').length;
  const activas = all.filter((c) => c.status !== 'archivada').length;

  /* ---- Lista filtrada + orden: activas primero, archivadas solo si se piden ---- */
  const filtered = useMemo(() => {
    const list = all.filter((c) => {
      if (inmueble !== 'todos' && data.getProperty(c.propertyId)?.slug !== inmueble) return false;
      if (estado === 'todos' && c.status === 'archivada') return false;
      if (estado !== 'todos' && c.status !== (estado as CleaningStatus)) return false;
      return true;
    });
    const weight = (c: (typeof all)[number]) => (c.status === 'archivada' ? 1 : 0);
    return [...list].sort((a, b) => {
      const w = weight(a) - weight(b);
      if (w !== 0) return w;
      return w === 0 && weight(a) === 1
        ? b.date.getTime() - a.date.getTime() // archivadas: más reciente primero
        : a.date.getTime() - b.date.getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, inmueble, estado, data.version]);

  return (
    <div className="flex flex-col gap-5">
      {/* ============================== Topbar */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] lg:text-[28px]">
            {t('limp.titulo')}
          </h1>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {t('limp.tareas', { count: activas })} · {t('limp.pendientes', { count: pendientes })}
          </p>
        </div>
        {!data.isDemo && (
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('limp.nuevaLimpieza')}</span>
            <span className="sm:hidden">{t('limp.nueva')}</span>
          </button>
        )}
      </div>

      {/* ============================== FilterBar */}
      <FilterBar typeOptions={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} typeParam="estado" />

      {/* ============================== KPIs */}
      <motion.section variants={containerV} initial="hidden" animate="show">
        <div className="snap-carousel -mx-4 flex gap-3 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
          <motion.div variants={itemV} className="w-[42vw] min-w-[160px] shrink-0 lg:w-auto">
            <KpiCard
              icon={Sparkles}
              tone="violet"
              label={t('limp.pendientesHoy')}
              value={pendientesHoy}
              sub={pendientesHoy > 0 ? t('limp.requierenAtencion') : t('limp.todoAlDia')}
              className="h-full"
            />
          </motion.div>
          <motion.div variants={itemV} className="w-[42vw] min-w-[160px] shrink-0 lg:w-auto">
            <div className={sinAsignar > 0 && !reduce ? 'animate-ring-pulse rounded-2xl' : undefined}>
              <KpiCard
                icon={UserRoundX}
                tone="orange"
                label={t('limp.sinAsignar')}
                value={sinAsignar}
                sub={sinAsignar > 0 ? t('limp.asignaCuantoAntes') : t('limp.todoAsignado')}
                className="h-full"
              />
            </div>
          </motion.div>
          <motion.div variants={itemV} className="w-[42vw] min-w-[160px] shrink-0 lg:w-auto">
            <KpiCard
              icon={Clock}
              tone="blue"
              label={t('limp.horasMes')}
              value={horasMes}
              decimals={1}
              unit="h"
              sub={t('limp.archivadas', { count: monthDone.length })}
              className="h-full"
            />
          </motion.div>
          <motion.div variants={itemV} className="w-[42vw] min-w-[160px] shrink-0 lg:w-auto">
            <KpiCard
              icon={Euro}
              tone="rose"
              label={t('limp.costeMes')}
              value={costeMes}
              unit="€"
              money
              sub={t('limp.horasProductos')}
              className="h-full"
            />
          </motion.div>
        </div>
      </motion.section>

      {/* ============================== Lista de tareas */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={t('limp.sinLimpiezas')}
          text={t('limp.sinLimpiezasTxt')}
        />
      ) : (
        <motion.section
          variants={containerV}
          initial="hidden"
          animate="show"
          className="grid gap-4 lg:grid-cols-2"
        >
          {filtered.map((c) => (
            <CleaningCard
              key={c.id}
              cleaning={c}
              variants={itemV}
              highlight={tareaParam === c.id}
              onCompleted={(total) => push(t('limp.confirmadaArchivada', { total: fmtMoney(total, true) }), 'violet')}
            />
          ))}
        </motion.section>
      )}

      {/* ============================== Dialog: nueva limpieza (real, valida backend) */}
      <NewCleaningDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(msg, ok) => push(msg, ok ? 'violet' : 'rose')}
      />

      <ToastHost toasts={toasts} />
    </div>
  );
}

/* ------------------------------------------------- Dialog "Nueva limpieza" */
function NewCleaningDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (msg: string, ok: boolean) => void;
}) {
  const { t } = useTranslation();
  const data = useData();
  const [slug, setSlug] = useState<string>();
  const [fecha, setFecha] = useState('');
  const [notas, setNotas] = useState('');
  const [busy, setBusy] = useState(false);
  const [occupiedWarn, setOccupiedWarn] = useState(false);

  const valid = Boolean(slug && fecha);

  const crear = async (force = false) => {
    const prop = data.getProperties().find((p) => p.slug === slug);
    if (!prop || !fecha || busy) return;
    setBusy(true);
    const res = await data.createCleaning(prop.id, new Date(`${fecha}T12:00:00`), undefined, force);
    setBusy(false);
    if (res === 'occupied') {
      // Aviso NO bloqueante: el usuario confirma y se reintenta con force
      setOccupiedWarn(true);
      return;
    }
    if (!res) {
      onCreated(t('limp.errorCrear'), false);
      return;
    }
    onCreated(t('limp.creada'), true);
    onOpenChange(false);
    setSlug(undefined);
    setFecha('');
    setNotas('');
    setOccupiedWarn(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold">{t('limp.nuevaLimpieza')}</DialogTitle>
          <DialogDescription style={{ color: 'var(--text-muted)' }}>
            {t('limp.nuevaDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
              {t('limp.inmueble')}
            </p>
            <Select value={slug} onValueChange={(v) => { setSlug(v); setOccupiedWarn(false); }}>
              <SelectTrigger className="h-10 w-full rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm shadow-none">
                <SelectValue placeholder={t('limp.seleccionaInmueble')} />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                {data.getProperties().map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
              {t('limp.fecha')}
            </p>
            <input
              type="date"
              value={fecha}
              onChange={(e) => { setFecha(e.target.value); setOccupiedWarn(false); }}
              className="h-10 w-full rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
              {t('limp.notas')}
            </p>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              placeholder={t('limp.notasPlaceholder')}
              className="w-full resize-none rounded-xl border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          {occupiedWarn && (
            <div
              className="flex flex-col gap-2 rounded-xl border px-3 py-2.5"
              style={{ borderColor: 'rgb(245 158 11 / 0.4)', backgroundColor: 'rgb(245 158 11 / 0.08)' }}
              role="alert"
            >
              <p className="text-[13px] font-semibold" style={{ color: '#B45309' }}>
                {t('limp.avisoOcupada')}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void crear(true)}
                className="flex h-9 items-center justify-center rounded-xl border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
                style={{ borderColor: 'rgb(245 158 11 / 0.4)', color: '#B45309' }}
              >
                {busy ? t('res.creando') : t('limp.crearIgualmente')}
              </button>
            </div>
          )}
          {!occupiedWarn && (
            <button
              type="button"
              disabled={!valid || busy}
              onClick={() => void crear()}
              className="flex h-11 w-full items-center justify-center rounded-xl bg-violet-500 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t('res.creando') : t('limp.crearLimpieza')}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
