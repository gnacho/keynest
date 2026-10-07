import { useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ChevronDown, Plus, Wrench } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import Fab from '@/components/Fab';
import FilterBar from '@/components/FilterBar';
import MaintenanceCard from '@/components/tareas/MaintenanceCard';
import { NewTaskDialog, type TaskPrefill } from '@/components/tareas/NewTaskDialog';
import { catIcon } from '@/lib/cat-icons';
import { myPropertyIds } from '@/lib/auth';
import { getFreeWindow } from '@/components/tareas/free-window';
import ToastHost from '@/components/tareas/toast';
import { useToasts } from '@/components/tareas/use-toasts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import type { MaintenanceCategory, MaintenanceStatus, MaintenanceTask } from '@/data/types';
import { fmtDateShort } from '@/lib/format';
import { chipStyle } from '@/lib/semantic';
import { cn } from '@/lib/utils';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

/** Date -> 'YYYY-MM-DD' en hora local (valor de <input type="date">). */
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const containerV: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const itemV: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT_QUART, staggerChildren: 0.06 },
  },
};

const COLUMNS: { status: MaintenanceStatus; labelKey: string; dot: string }[] = [
  { status: 'nueva', labelKey: 'mant.colNueva', dot: '#64748B' },
  { status: 'asignada', labelKey: 'mant.colAsignada', dot: '#3B82F6' },
  { status: 'finalizada', labelKey: 'mant.colFinalizada', dot: '#10B981' },
];



export default function Mantenimiento() {
  const { t: tr } = useTranslation();
  const data = useData();
  const { toasts, push } = useToasts();
  const [params, setParams] = useSearchParams();
  const [categoria, setCategoria] = useState<MaintenanceCategory | 'todas'>('todas');
  const [soloUrgentes, setSoloUrgentes] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [editTask, setEditTask] = useState<MaintenanceTask | null>(null);
  const [openSections, setOpenSections] = useState<Record<MaintenanceStatus, boolean>>({
    nueva: true,
    asignada: true,
    finalizada: false,
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<MaintenanceStatus | null>(null);

  const CATEGORY_OPTIONS = data.getCategories().map((c) => ({
    value: c.key as MaintenanceCategory,
    label: c.label,
    labelKey: c.key,
    icon: catIcon(c.icon),
  }));

  const inmueble = params.get('inmueble') ?? 'todos';
  const all = data.getMaintenance();
  const mine = myPropertyIds(data.getProperties());
  const urgentes = all.filter((t) => t.urgent && t.status !== 'finalizada').length;
  const avisoDias = data.getSettings().nDays;
  const [mostrarAntiguas, setMostrarAntiguas] = useState(false);
  // eslint-disable-next-line react-hooks/purity -- umbral de días: necesita la hora actual
  const umbralAntiguas = Date.now() - avisoDias * 86400000;
  const antiguasOcultas = all.filter(
    (t) => t.status === 'finalizada' && t.scheduledDate && t.scheduledDate.getTime() < umbralAntiguas,
  ).length;

  const filtered = useMemo(
    () =>
      all.filter((t) => {
        if (inmueble === 'mis') {
          if (!mine.has(t.propertyId)) return false;
        } else if (inmueble !== 'todos' && data.getProperty(t.propertyId)?.slug !== inmueble) return false;
        if (categoria !== 'todas' && t.category !== categoria) return false;
        if (soloUrgentes && !t.urgent) return false;
        if (!mostrarAntiguas && t.status === 'finalizada' && t.scheduledDate && t.scheduledDate.getTime() < umbralAntiguas) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, inmueble, categoria, soloUrgentes, mostrarAntiguas, mine, data.version],
  );

  const byStatus = (s: MaintenanceStatus) =>
    filtered
      .filter((t) => t.status === s)
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.createdAt.getTime() - a.createdAt.getTime());

  const selectedProperty = inmueble !== 'todos' && inmueble !== 'mis' ? data.getProperty(inmueble) : undefined;
  const freeWindow = useMemo(
    () => (selectedProperty ? getFreeWindow(data, selectedProperty.id) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, selectedProperty?.id, data.version],
  );

  // Deep-link desde Tedee (#280): ?nueva=pilas&cerradura=<nombre> abre el diálogo
  // de nueva tarea pre-rellenado (inmueble, título, fecha libre, propietario).
  const nuevaParam = params.get('nueva');
  const cerraduraParam = params.get('cerradura');
  const pilasPrefill = useMemo(() => {
    if (nuevaParam !== 'pilas' || !selectedProperty) return undefined;
    return {
      slug: selectedProperty.slug,
      title: tr('mant.tareaPilasTitulo', { lock: cerraduraParam ?? selectedProperty.name }),
      category: 'cerradura/pilas' as MaintenanceCategory,
      expenseTag: 'cerradura/pilas',
      scheduledDate: toDateInput(freeWindow?.start ?? new Date()),
      assignedUserId: selectedProperty.ownerId ?? undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nuevaParam, selectedProperty?.id, cerraduraParam, freeWindow?.start]);

  // Abre el diálogo una sola vez, guarda el prefill en estado (los params se
  // limpian de la URL justo después: el prefill no debe recalcularse a undefined).
  // Si YA existe una tarea de pilas para esa cerradura (#288), abre la más
  // reciente en edición (aunque esté finalizada: la batería tarda en
  // actualizarse tras el cambio) en lugar de crear otra.
  const [prefillTarea, setPrefillTarea] = useState<TaskPrefill | undefined>();
  useEffect(() => {
    if (!pilasPrefill || !selectedProperty) return;
    const lockName = cerraduraParam ?? '';
    const existente = all
      .filter(
        (t) =>
          t.propertyId === selectedProperty.id &&
          t.category === 'cerradura/pilas' &&
          (!lockName || t.title.toLowerCase().includes(lockName.toLowerCase())),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (existente) {
      setEditTask(existente);
    } else {
      setNewOpen(true);
      setPrefillTarea(pilasPrefill);
    }
    const next = new URLSearchParams(params);
    next.delete('nueva');
    next.delete('cerradura');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilasPrefill]);

  const renderCard = (t: MaintenanceTask, animateEntry: boolean) => (
    <MaintenanceCard
      key={t.id}
      task={t}
      variants={itemV}
      animateEntry={animateEntry}
      onFinished={() => push(tr('mant.tareaFinalizada'), 'emerald')}
      onEdit={() => setEditTask(t)}
    />
  );

  const endDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  const renderDraggableCard = (t: MaintenanceTask, animateEntry: boolean) => (
    <div
      key={t.id}
      draggable={!data.isDemo}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
        setDraggingId(t.id);
        // Drag image ampliada: el clon del navegador es diminuto y no da control.
        // Renderizamos un clon a escala con sombra y rotación sutil para que la
        // tarjeta se lea como "la que se mueve" (#109).
        const src = e.currentTarget;
        const clone = src.cloneNode(true) as HTMLElement;
        clone.style.position = 'absolute';
        clone.style.top = '-10000px';
        clone.style.left = '0';
        clone.style.width = '320px';
        clone.style.opacity = '0.95';
        clone.style.transform = 'scale(1.04) rotate(1deg)';
        clone.style.boxShadow = '0 16px 40px rgba(0,0,0,0.28)';
        clone.style.borderRadius = '16px';
        clone.style.pointerEvents = 'none';
        document.body.appendChild(clone);
        e.dataTransfer.setDragImage(clone, 60, 40);
        requestAnimationFrame(() => clone.remove());
      }}
      onDragEnd={endDrag}
      className={cn(
        data.isDemo ? '' : 'cursor-grab active:cursor-grabbing',
        draggingId === t.id && 'scale-[1.02] opacity-60 shadow-lg ring-1 ring-[#6366F1]/50',
      )}
    >
      {renderCard(t, animateEntry)}
    </div>
  );

  const handleDrop = (e: DragEvent, col: (typeof COLUMNS)[number]) => {
    e.preventDefault();
    if (data.isDemo) return;
    const id = e.dataTransfer.getData('text/plain');
    const task = all.find((x) => x.id === id);
    endDrag();
    if (!task || task.status === col.status) return;
    data.setMaintenanceStatus(id, col.status);
    if (col.status === 'finalizada') push(tr('mant.tareaFinalizada'), 'emerald');
    else push(tr('mant.movidaA', { col: tr(col.labelKey) }), col.status === 'asignada' ? 'blue' : 'slate');
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ============================== FilterBar + dropdown categoría + urgentes */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar className="mx-0 px-0" />
        <Select value={categoria} onValueChange={(v) => setCategoria(v as MaintenanceCategory | 'todas')}>
          <SelectTrigger className="h-9 w-[190px] rounded-xl border-[var(--border)] bg-[var(--surface)] text-xs font-semibold shadow-none">
            <SelectValue placeholder={tr('mant.todas')} />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
            <SelectItem value="todas">{tr('mant.todas')}</SelectItem>
            {CATEGORY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                <span className="flex items-center gap-2">
                  <o.icon className="h-3.5 w-3.5" />
                  {o.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => setSoloUrgentes((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors duration-150',
            soloUrgentes ? 'border-rose-500 text-white' : 'text-rose-500',
          )}
          style={soloUrgentes ? { backgroundColor: '#F43F5E' } : { borderColor: 'rgb(244 63 94 / 0.5)' }}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', soloUrgentes ? 'bg-white' : 'animate-dot-pulse bg-rose-500')} />
          {tr('mant.soloUrgentes')}
        </button>
        {antiguasOcultas > 0 && (
          <button
            type="button"
            onClick={() => setMostrarAntiguas((v) => !v)}
            className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            {mostrarAntiguas ? tr('mant.ocultarAntiguas') : tr('mant.mostrarAntiguas', { dias: avisoDias })}
          </button>
        )}
        {!data.isDemo && (
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="ml-auto brand-gradient hidden h-9 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] lg:flex"
          >
            <Plus className="h-4 w-4" />
            <span>{tr('mant.nuevaTarea')}</span>
          </button>
        )}
      </div>

      {/* ============================== Banner por inmueble */}
      {selectedProperty && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT_QUART }}
          className="card relative h-[120px] overflow-hidden"
        >
          <img
            src={selectedProperty.photo}
            alt={selectedProperty.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 p-3.5">
            <div>
              <p className="font-display text-[17px] font-semibold text-white">{selectedProperty.name}</p>
              <p className="text-xs text-white/80">{selectedProperty.address}</p>
            </div>
            {freeWindow && (
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
                style={chipStyle('blue')}
              >
                {tr('mant.primeraDesocupacion', { date: fmtDateShort(freeWindow.start), days: freeWindow.days })}
              </span>
            )}
          </div>
        </motion.div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title={tr('mant.sinTareas')}
          text={tr('mant.sinTareasTxt')}
        />
      ) : (
        <>
          {/* ============================== Kanban desktop (≥ lg) */}
          <motion.section
            variants={containerV}
            initial="hidden"
            animate="show"
            className="hidden gap-5 lg:grid lg:grid-cols-3"
          >
            {COLUMNS.map((col) => {
              const tasks = byStatus(col.status);
              const isTarget = dropTarget === col.status && draggingId !== null;
              return (
                <motion.div key={col.status} variants={itemV} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 px-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col.dot }} />
                    <h2 className="font-display text-[15px] font-semibold">{tr(col.labelKey)}</h2>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
                    >
                      {tasks.length}
                    </span>
                  </div>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropTarget !== col.status) setDropTarget(col.status);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
                    }}
                    onDrop={(e) => handleDrop(e, col)}
                    className={cn(
                      'flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-2xl pr-1 transition-all duration-150',
                      isTarget && 'bg-[var(--surface-2)] p-2 ring-2 ring-dashed ring-[#6366F1]/60',
                    )}
                  >
                    {tasks.map((t) => renderDraggableCard(t, col.status !== 'finalizada'))}
                    {tasks.length === 0 && (
                      <p
                        className="rounded-2xl border border-dashed px-3 py-6 text-center text-xs"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
                      >
                        {isTarget ? 'Suelta aquí' : 'Sin tareas'}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.section>

          {/* ============================== Lista agrupada móvil (< lg) */}
          <section className="flex flex-col gap-4 lg:hidden">
            {COLUMNS.map((col) => {
              const tasks = byStatus(col.status);
              const open = openSections[col.status];
              return (
                <div key={col.status}>
                  <button
                    type="button"
                    onClick={() => setOpenSections((s) => ({ ...s, [col.status]: !s[col.status] }))}
                    className="flex w-full items-center gap-2 rounded-xl px-2 py-2"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col.dot }} />
                    <h2 className="font-display text-[15px] font-semibold">{tr(col.labelKey)}</h2>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
                    >
                      {tasks.length}
                    </span>
                    <ChevronDown
                      className={cn('ml-auto h-4 w-4 transition-transform duration-200', open && 'rotate-180')}
                      style={{ color: 'var(--text-faint)' }}
                    />
                  </button>
                  {open && (
                    <motion.div
                      variants={containerV}
                      initial="hidden"
                      animate="show"
                      className="mt-2 flex flex-col gap-3"
                    >
                      {tasks.map((t) => renderCard(t, col.status !== 'finalizada'))}
                      {tasks.length === 0 && (
                        <p
                          className="rounded-2xl border border-dashed px-3 py-5 text-center text-xs"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
                        >
                          {tr('mant.sinTareasCol')}
                        </p>
                      )}
                    </motion.div>
                  )}
                </div>
              );
            })}
          </section>
        </>
      )}

      {/* ============================== Dialogs: nueva tarea / editar (real, BD) */}
      <NewTaskDialog
        open={newOpen}
        onOpenChange={(o) => {
          setNewOpen(o);
          if (!o) setPrefillTarea(undefined);
        }}
        onCreated={() => push(tr('mant.tareaCreadaOk'), 'rose')}
        prefill={prefillTarea}
      />
      <NewTaskDialog
        open={editTask !== null}
        onOpenChange={(o) => !o && setEditTask(null)}
        onCreated={() => push(tr('mant.tareaActualizada'), 'rose')}
        task={editTask}
      />

      <ToastHost toasts={toasts} />

      <p className="text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
        {tr('mant.tareas', { count: all.length })} · {tr('mant.urgentes', { count: urgentes })}
      </p>

      {!data.isDemo && <Fab onClick={() => setNewOpen(true)} aria-label={tr('mant.nuevaTarea')} />}
    </div>
  );
}
