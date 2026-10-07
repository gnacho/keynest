import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { useData } from '@/data/useData';
import type { MaintenanceCategory, MaintenanceTask } from '@/data/types';
import { cn } from '@/lib/utils';

/** Date -> 'YYYY-MM-DD' en hora local (valor de <input type="date">). */
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface TaskPrefill {
  slug: string;
  title: string;
  category: MaintenanceCategory;
  expenseTag: string;
  /** 'YYYY-MM-DD' */
  scheduledDate: string;
  assignedUserId?: string;
}

export function NewTaskDialog({
  open,
  onOpenChange,
  onCreated,
  task,
  prefill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
  task?: MaintenanceTask | null;
  prefill?: TaskPrefill;
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
  const [fecha, setFecha] = useState('');
  const [responsable, setResponsable] = useState<string>();

  const reset = () => {
    setSlug(undefined);
    setTitulo('');
    setCategoria(undefined);
    setEtiqueta('');
    setUrgente(false);
    setNotas('');
    setChecksText('');
    setFecha('');
    setResponsable(undefined);
  };

  // Modo edición: precargar la tarea; modo deep-link (#280): prefill de pilas;
  // si no, diálogo limpio.
  useEffect(() => {
    if (!open) return;
    if (task) {
      const prop = data.getProperty(task.propertyId);
      setSlug(prop?.slug);
      setTitulo(task.title);
      setCategoria(task.category);
      setEtiqueta(task.expenseTag);
      setUrgente(task.urgent);
      setNotas(task.notes);
      setChecksText((task.checks ?? []).map((k) => k.label).join('\n'));
      setFecha(task.scheduledDate ? toDateInput(task.scheduledDate) : '');
      setResponsable(task.assignedUserId);
    } else if (prefill) {
      setSlug(prefill.slug);
      setTitulo(prefill.title);
      setCategoria(prefill.category);
      setEtiqueta(prefill.expenseTag);
      setUrgente(false);
      setNotas('');
      setChecksText('');
      setFecha(prefill.scheduledDate);
      setResponsable(prefill.assignedUserId);
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id, prefill]);

  const valid = Boolean(slug && titulo.trim() && categoria);
  const [busy, setBusy] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

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
        scheduledDate: fecha || null,
        assignedUserId: responsable ?? null,
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
      scheduledDate: fecha || null,
      assignedUserId: responsable ?? null,
    });
    setBusy(false);
    if (created) {
      onCreated();
      onOpenChange(false);
      reset();
    }
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
          <div>
            {label(tr('mant.fechaPrevista'))}
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="h-10 w-full rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
          <div>
            {label(tr('mant.responsable'))}
            <Select value={responsable ?? '__none__'} onValueChange={(v) => setResponsable(v === '__none__' ? undefined : v)}>
              <SelectTrigger className="h-10 w-full rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm shadow-none">
                <SelectValue placeholder={tr('mant.sinResponsable')} />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                <SelectItem value="__none__">{tr('mant.sinResponsable')}</SelectItem>
                {data.getUsers().map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div className={`flex gap-2 sm:col-span-2 ${task ? 'flex-row' : ''}`}>
            {task && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (deleteConfirming) {
                    void data.deleteMaintenance(task.id);
                    setDeleteConfirming(false);
                    onCreated();
                    onOpenChange(false);
                    reset();
                  } else {
                    setDeleteConfirming(true);
                    setTimeout(() => setDeleteConfirming(false), 3000);
                  }
                }}
                className={cn(
                  'flex h-11 items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition-all duration-150 disabled:opacity-50',
                  deleteConfirming
                    ? 'border-rose-300 bg-rose-500 text-white'
                    : 'hover:bg-[var(--ro-chip-bg)]',
                )}
                style={deleteConfirming ? undefined : { borderColor: 'rgb(244 63 94 / 0.5)', color: '#F43F5E' }}
              >
                <Trash2 className="h-4 w-4" />
                {deleteConfirming ? tr('mant.seguro') : tr('mant.eliminar')}
              </button>
            )}
            <button
              type="button"
              disabled={!valid || busy}
              onClick={() => void crear()}
              className="brand-gradient flex h-11 flex-1 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? tr('res.creando') : task ? tr('mant.guardar') : tr('mant.crearTarea')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
