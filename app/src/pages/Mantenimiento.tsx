import { useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ChevronDown, Plus, Wrench } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import MaintenanceCard from '@/components/tareas/MaintenanceCard';
import { catIcon } from '@/lib/cat-icons';
import { getFreeWindow } from '@/components/tareas/free-window';
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
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import type { MaintenanceCategory, MaintenanceStatus, MaintenanceTask } from '@/data/types';
import { fmtDateShort } from '@/lib/format';
import { chipStyle } from '@/lib/semantic';
import { cn } from '@/lib/utils';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

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
  const [params] = useSearchParams();
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
  const urgentes = all.filter((t) => t.urgent && t.status !== 'finalizada').length;

  const filtered = useMemo(
    () =>
      all.filter((t) => {
        if (inmueble !== 'todos' && data.getProperty(t.propertyId)?.slug !== inmueble) return false;
        if (categoria !== 'todas' && t.category !== categoria) return false;
        if (soloUrgentes && !t.urgent) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, inmueble, categoria, soloUrgentes, data.version],
  );

  const byStatus = (s: MaintenanceStatus) =>
    filtered
      .filter((t) => t.status === s)
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.createdAt.getTime() - a.createdAt.getTime());

  const selectedProperty = inmueble !== 'todos' ? data.getProperty(inmueble) : undefined;
  const freeWindow = useMemo(
    () => (selectedProperty ? getFreeWindow(data, selectedProperty.id) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, selectedProperty?.id, data.version],
  );

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
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
        setDraggingId(t.id);
      }}
      onDragEnd={endDrag}
      className={cn(
        'cursor-grab active:cursor-grabbing',
        draggingId === t.id && 'opacity-40',
      )}
    >
      {renderCard(t, animateEntry)}
    </div>
  );

  const handleDrop = (e: DragEvent, col: (typeof COLUMNS)[number]) => {
    e.preventDefault();
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
      {/* ============================== Topbar */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] lg:text-[28px]">
            {tr('mant.titulo')}
          </h1>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {tr('mant.tareas', { count: all.length })} · {tr('mant.urgentes', { count: urgentes })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-rose-500 px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{tr('mant.nuevaTarea')}</span>
          <span className="sm:hidden">{tr('mant.nueva')}</span>
        </button>
      </div>

      {/* ============================== FilterBar + chips de categoría + urgentes */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar className="mx-0 px-0" />
        <div
          className="flex items-center gap-1 overflow-x-auto rounded-xl border p-1 no-scrollbar"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <button
            type="button"
            onClick={() => setCategoria('todas')}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-1 text-xs font-semibold transition-colors duration-150',
              categoria === 'todas' ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
            style={categoria === 'todas' ? { backgroundColor: '#F43F5E' } : undefined}
          >
            {tr('mant.todas')}
          </button>
          {CATEGORY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setCategoria(categoria === o.value ? 'todas' : o.value)}
              className={cn(
                'flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors duration-150',
                categoria === o.value ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
              style={categoria === o.value ? { backgroundColor: '#F43F5E' } : undefined}
            >
              <o.icon className="h-3.5 w-3.5" />
              {o.label}
            </button>
          ))}
        </div>
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
                    className="sticky top-[104px] z-20 flex w-full items-center gap-2 rounded-xl px-2 py-2 backdrop-blur-md"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--bg) 88%, transparent)' }}
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
        onOpenChange={setNewOpen}
        onCreated={() => push(tr('mant.tareaCreadaOk'), 'rose')}
      />
      <NewTaskDialog
        open={editTask !== null}
        onOpenChange={(o) => !o && setEditTask(null)}
        onCreated={() => push(tr('mant.tareaActualizada'), 'rose')}
        task={editTask}
      />

      <ToastHost toasts={toasts} />
    </div>
  );
}

/* ---------------------------------------------------- Dialog "Nueva tarea" */
function NewTaskDialog({
  open,
  onOpenChange,
  onCreated,
  task,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
  task?: MaintenanceTask | null;
}) {
  const { t: tr } = useTranslation();
  const data = useData();
  const CATEGORY_OPTIONS = data.getCategories().map((c) => ({
    value: c.key as MaintenanceCategory,
    label: c.label,
  }));
  const [slug, setSlug] = useState<string>();
  const [titulo, setTitulo] = useState('');
  const [categoria, setCategoria] = useState<MaintenanceCategory>();
  const [etiqueta, setEtiqueta] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [notas, setNotas] = useState('');
  const [checksText, setChecksText] = useState('');

  // Modo edición: precargar la tarea
  useEffect(() => {
    if (open && task) {
      const prop = data.getProperty(task.propertyId);
      setSlug(prop?.slug);
      setTitulo(task.title);
      setCategoria(task.category);
      setEtiqueta(task.expenseTag);
      setUrgente(task.urgent);
      setNotas(task.notes);
      setChecksText((task.checks ?? []).map((k) => k.label).join('\n'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const valid = Boolean(slug && titulo.trim() && categoria);
  const [busy, setBusy] = useState(false);

  const checksFromText = () =>
    checksText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label, i) => ({ id: `chk-${i}`, label, done: false }));

  const crear = async () => {
    if (!valid || busy) return;
    setBusy(true);
    if (task) {
      // Preserva el estado done de los checks que siguen existiendo
      const prev = new Map((task.checks ?? []).map((k) => [k.label, k.done]));
      const checks = checksFromText().map((k) => ({ ...k, done: prev.get(k.label) ?? false }));
      await data.editMaintenance(task.id, {
        title: titulo.trim(),
        category: categoria ?? '',
        expenseTag: etiqueta.trim() || (categoria ?? ''),
        urgent: urgente,
        notes: notas.trim(),
        checks,
      });
      setBusy(false);
      onCreated();
      onOpenChange(false);
      reset();
      return;
    }
    const prop = data.getProperties().find((p) => p.slug === slug);
    if (!prop) { setBusy(false); return; }
    const created = await data.addMaintenance({
      propertyId: prop.id,
      title: titulo.trim(),
      category: categoria ?? '',
      expenseTag: etiqueta.trim() || (categoria ?? ''),
      urgent: urgente,
      notes: notas.trim(),
      checks: checksFromText(),
    });
    setBusy(false);
    if (created) {
      onCreated();
      onOpenChange(false);
      reset();
    }
  };

  const reset = () => {
    setSlug(undefined);
    setTitulo('');
    setCategoria(undefined);
    setEtiqueta('');
    setUrgente(false);
    setNotas('');
    setChecksText('');
  };

  const label = (text: string) => (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
      {text}
    </p>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold">
            {task ? tr('mant.editarTitulo') : tr('mant.nuevaTarea')}
          </DialogTitle>
          <DialogDescription style={{ color: 'var(--text-muted)' }}>
            {task ? tr('mant.editarDesc') : tr('mant.nuevaDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[85vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          <div>
            {label(tr('mant.inmueble'))}
            <Select value={slug} onValueChange={setSlug} disabled={Boolean(task)}>
              <SelectTrigger className="h-10 w-full rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm shadow-none">
                <SelectValue placeholder={tr('mant.seleccionaInmueble')} />
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
            {label(tr('mant.categoria'))}
            <Select value={categoria} onValueChange={(v) => setCategoria(v as MaintenanceCategory)}>
              <SelectTrigger className="h-10 w-full rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm shadow-none">
                <SelectValue placeholder={tr('mant.seleccionaCategoria')} />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                {CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            {label(tr('mant.tituloCampo'))}
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={tr('mant.tituloPlaceholder')}
              className="h-10 w-full rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div>
            {label(tr('mant.etiquetaGasto'))}
            <input
              value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)}
              placeholder={tr('mant.etiquetaPlaceholder')}
              className="h-10 w-full rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div className="flex items-center justify-between self-end rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold text-rose-500">{tr('mant.urgente')}</span>
            <Switch checked={urgente} onCheckedChange={setUrgente} />
          </div>
          <div className="sm:col-span-2">
            {label(tr('mant.notas'))}
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder={tr('mant.notasPlaceholder')}
              className="w-full resize-none rounded-xl border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div className="sm:col-span-2">
            {label(tr('mant.checks'))}
            <textarea
              value={checksText}
              onChange={(e) => setChecksText(e.target.value)}
              rows={3}
              placeholder={tr('mant.checksPlaceholder')}
              className="w-full resize-none rounded-xl border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]"
              style={{ borderColor: 'var(--border)' }}
            />
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {tr('mant.checksNota')}
            </span>
          </div>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void crear()}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-rose-500 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
          >
            {busy ? tr('res.creando') : task ? tr('mant.guardar') : tr('mant.crearTarea')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
