import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import {
  Ban,
  BedDouble,
  BookOpen,
  CalendarDays,
  Check,
  DoorOpen,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  Settings2,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import PhotoCropDialog from '@/components/PhotoCropDialog';
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
import { cachedUser } from '@/lib/auth';
import { fmtDateShort, fmtRelative } from '@/lib/format';
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

const PROP_ACTIONS = [
  { to: '/calendario', labelKey: 'nav.calendario', icon: CalendarDays, color: '#3B82F6' },
  { to: '/reservas', labelKey: 'nav.reservas', icon: BookOpen, color: '#10B981' },
  { to: '/limpieza', labelKey: 'nav.limpieza', icon: Sparkles, color: '#8B5CF6' },
  { to: '/rentabilidad', labelKey: 'nav.rentabilidad', icon: TrendingUp, color: '#6366F1' },
] as const;

interface PropertyOverride {
  name: string;
  address: string;
  bedrooms: number;
  bathrooms: number;
  area: number;
  icalUrl: string;
  ownerId: string | null;
}

const inputCls =
  'h-10 rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40';
const inputStyle = { borderColor: 'var(--border)' };

/** Gestión de inmuebles: tarjetas + edición real contra el backend. */
export default function Inmuebles() {
  const { t: tr } = useTranslation();
  const data = useData();

  const isDemoUser = Boolean(cachedUser()?.is_demo);

  /* ---- Inmuebles: edición real contra el backend ---- */
  const properties = data.getProperties();
  const syncStatus = data.getSyncStatus();
  const [editProp, setEditProp] = useState<string | 'new' | null>(null);
  const [params, setParams] = useSearchParams();
  const pendingEditId = params.get('editar') ?? undefined;
  useEffect(() => {
    if (!pendingEditId || pendingEditId === 'todos') return;
    const p = properties.find((x) => x.id === pendingEditId);
    if (p) {
      openEditProp(pendingEditId);
      const next = new URLSearchParams(params);
      next.delete('editar');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEditId, properties.length]);
  const [icalCheck, setIcalCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; count?: number; code?: string; status?: number }>({ state: 'idle' });
  const [editingIcal, setEditingIcal] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoPick = (file: File | undefined) => {
    if (!file || !editProp || editProp === 'new') return;
    setCropFile(file); // abre el diálogo de recorte
  };

  /** Recorte confirmado: el diálogo devuelve un WebP 800×600 (fallback JPEG). */
  const uploadCroppedPhoto = async (blob: Blob) => {
    if (!editProp || editProp === 'new') return;
    setUploadingPhoto(true);
    try {
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
      const file = new File([blob], `foto-${editProp}.${ext}`, { type: blob.type });
      const updated = await data.uploadPropertyPhoto(editProp, file);
      if (!updated) throw new Error('upload');
      toast.success(tr('aj.fotoOk'));
    } catch {
      toast.error(tr('aj.fotoError'));
    } finally {
      setUploadingPhoto(false);
    }
  };
  const [propForm, setPropForm] = useState<PropertyOverride>({ name: '', address: '', bedrooms: 1, bathrooms: 1, area: 0, icalUrl: '', ownerId: null });
  const [flashProp, setFlashProp] = useState<string | null>(null);

  const [checklistText, setChecklistText] = useState('');
  const [instructionsText, setInstructionsText] = useState('');
  // Editor a pantalla completa para checklist/instrucciones en móvil.
  const [fullEditor, setFullEditor] = useState<'checklist' | 'instrucciones' | null>(null);

  const openEditProp = (id: string) => {
    const p = properties.find((x) => x.id === id)!;
    setPropForm({
      name: p.name,
      address: p.address,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      area: p.area,
      icalUrl: p.icalUrl ?? '',
      ownerId: p.ownerId ?? null,
    });
    setChecklistText(p.checklist.join('\n'));
    setInstructionsText(p.instructions);
    setIcalCheck({ state: 'idle' });
    setEditingIcal(false);
    setEditProp(id);
  };

  const openNewProp = () => {
    setPropForm({ name: '', address: '', bedrooms: 1, bathrooms: 1, area: 0, icalUrl: '', ownerId: null });
    setChecklistText('');
    setInstructionsText('');
    setIcalCheck({ state: 'idle' });
    setEditingIcal(false);
    setEditProp('new');
  };

  const verifyIcal = async (url: string): Promise<boolean> => {
    setIcalCheck({ state: 'checking' });
    try {
      const res = await fetch('/api/ical/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { ok: boolean; count?: number; code?: string; status?: number };
      if (data.ok) {
        setIcalCheck({ state: 'ok', count: data.count });
        return true;
      }
      setIcalCheck({ state: 'error', code: data.code, status: data.status });
      return false;
    } catch {
      setIcalCheck({ state: 'error', code: 'fetch' });
      return false;
    }
  };

  // #93: si la URL actual está configurada y OK, avisar antes de editar.
  const startEditIcal = () => {
    if (propForm.icalUrl && icalCheck.state !== 'error') {
      if (!window.confirm(tr('aj.icalWarning'))) return;
    }
    setEditingIcal(true);
  };

  const icalErrorText = (): string => {
    if (icalCheck.state !== 'error') return '';
    switch (icalCheck.code) {
      case 'url': return tr('aj.icalErrUrl');
      case 'http': return tr('aj.icalErrHttp', { status: icalCheck.status ?? '' });
      case 'not-ics': return tr('aj.icalErrNotIcs');
      case 'empty': return tr('aj.icalErrEmpty');
      default: return tr('aj.icalErrFetch');
    }
  };

  const saveProp = async () => {
    if (!editProp) return;
    const items = checklistText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const input = {
      name: propForm.name.trim(),
      address: propForm.address.trim(),
      bedrooms: propForm.bedrooms,
      bathrooms: propForm.bathrooms,
      area: propForm.area,
      photo: editProp === 'new' ? '/prop-carmen.svg' : (properties.find((x) => x.id === editProp)?.photo ?? '/prop-carmen.svg'),
      icalUrl: propForm.icalUrl.trim(),
      checklist: items,
      instructions: instructionsText.trim(),
      ownerId: propForm.ownerId,
    };
    if (!input.name) return;
    if (input.icalUrl) {
      const ok = await verifyIcal(input.icalUrl);
      if (!ok) return; // aviso inline: corrige la URL o déjala vacía
    }
    try {
      const saved = editProp === 'new' ? await data.addProperty(input) : await data.saveProperty(editProp, input);
      setEditProp(null);
      toast.success(editProp === 'new' ? tr('aj.inmuebleCreado') : tr('aj.inmuebleActualizado'));
      if (saved) {
        setFlashProp(saved.id);
        setTimeout(() => setFlashProp(null), 1300);
      }
      // Si tiene iCal, sincroniza en segundo plano
      if (input.icalUrl) void data.syncNow();
    } catch {
      toast.error(tr('aj.errorGuardar'));
    }
  };

  const editProperty = editProp ? properties.find((p) => p.id === editProp) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!isDemoUser && (
          <>
            <button
              type="button"
              onClick={openNewProp}
              className="brand-gradient flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              {tr('aj.nuevoInmueble')}
            </button>
          </>
        )}
      </div>

      <motion.div variants={containerV} initial="hidden" animate="show" className="grid gap-4 lg:grid-cols-2">
        {properties.map((p) => {
          const name = p.name;
          const address = p.address;
          const bedrooms = p.bedrooms;
          const area = p.area;
          const bathrooms = p.bathrooms;
          const occ = data.getOccupancy(p.id, new Date());
          return (
            <motion.article
              key={p.id}
              variants={itemV}
              className={cn('card group overflow-hidden transition-shadow duration-200', flashProp === p.id && 'ring-2 ring-[#6366F1]')}
            >
              <div className="relative h-[120px] overflow-hidden">
                <img src={p.photo} alt={name} loading="lazy" className="h-full w-full object-cover" />
                <div
                  className="absolute inset-0"
                  style={{ background: 'linear-gradient(180deg, transparent 30%, rgb(0 0 0 / 0.45) 100%)' }}
                />
                <span
                  className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md"
                  style={
                    occ.occupied
                      ? { backgroundColor: 'rgb(59 130 246 / 0.9)', color: '#fff' }
                      : { backgroundColor: 'rgb(15 23 42 / 0.55)', color: '#E2E8F0' }
                  }
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', occ.occupied ? 'bg-white' : 'bg-slate-300')} />
                  {occ.occupied ? tr('aj.ocupado') : occ.freeSince ? tr('aj.libreDesde', { date: fmtDateShort(occ.freeSince) }) : tr('aj.libre')}
                </span>
                {!isDemoUser && (
                  <button
                    type="button"
                    aria-label={tr('aj.editar', { name })}
                    onClick={() => openEditProp(p.id)}
                    className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-md transition-transform duration-200 hover:rotate-90"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--surface) 90%, transparent)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <Settings2 className="h-4 w-4" />
                  </button>
                )}
                <div className="absolute bottom-2.5 left-3 right-3">
                  <p className="font-display text-[17px] font-semibold leading-5 text-white">{name}</p>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 p-4">
                <p className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {address}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    <BedDouble className="h-3.5 w-3.5" />
                    {bedrooms} {tr('aj.dorm')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    <Ruler className="h-3.5 w-3.5" />
                    {area} m²
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    <DoorOpen className="h-3.5 w-3.5" />{tr('aj.banos', { count: bathrooms })}
                  </span>
                </div>
                {p.icalUrl ? (
                  <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', syncStatus[p.id]?.ok === false ? 'bg-rose-500' : 'bg-emerald-500')} />
                    {syncStatus[p.id]?.ok === false
                      ? tr('aj.icalError', { error: syncStatus[p.id]?.error ?? '' })
                      : syncStatus[p.id]?.at
                        ? tr('aj.icalOk', { count: syncStatus[p.id].count ?? 0, time: fmtRelative(new Date(syncStatus[p.id].at)) })
                        : tr('aj.icalPendiente')}
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-faint)' }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                    {tr('aj.sinIcal')}
                  </p>
                )}
                <div className="grid grid-cols-4 gap-1 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                  {PROP_ACTIONS.map(({ to, labelKey, icon: Icon, color }) => (
                    <Link
                      key={to}
                      to={`${to}?inmueble=${p.slug}`}
                      className="flex flex-col items-center gap-1 rounded-xl py-2 transition-colors duration-150 hover:bg-[var(--surface-2)]"
                    >
                      <Icon className="h-[18px] w-[18px]" style={{ color }} strokeWidth={2} />
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                        {tr(labelKey)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </motion.article>
          );
        })}
      </motion.div>

      {/* ============================== Dialog edición inmueble */}
      <Dialog open={!!editProp} onOpenChange={(o) => !o && setEditProp(null)}>
        <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">
              {editProp === 'new' ? tr('aj.nuevoInmueble') : tr('aj.editar')}
            </DialogTitle>
            <DialogDescription style={{ color: 'var(--text-muted)' }}>
              {editProp === 'new'
                ? tr('aj.nuevoDesc')
                : tr('aj.editarDesc', { name: editProperty?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          {(editProperty || editProp === 'new') && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="relative h-28 overflow-hidden rounded-xl sm:col-span-2">
                <img src={editProperty?.photo ?? '/prop-carmen.svg'} alt={propForm.name} className="h-full w-full object-cover" />
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    handlePhotoPick(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                {editProp !== 'new' && (
                  <button
                    type="button"
                    disabled={uploadingPhoto}
                    onClick={() => photoInputRef.current?.click()}
                    className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-md disabled:opacity-60"
                    style={{ backgroundColor: 'rgb(12 20 37 / 0.55)' }}
                  >
                    {uploadingPhoto && <RefreshCw className="h-3 w-3 animate-spin" />}
                    {uploadingPhoto ? tr('aj.subiendoFoto') : tr('aj.cambiarFoto')}
                  </button>
                )}
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.nombre')}
                </span>
                <input value={propForm.name} onChange={(e) => setPropForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.direccion')}
                </span>
                <input value={propForm.address} onChange={(e) => setPropForm((f) => ({ ...f, address: e.target.value }))} className={inputCls} style={inputStyle} />
              </label>
              <div className="grid grid-cols-3 gap-3 sm:col-span-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.dormitorios')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={propForm.bedrooms}
                    onChange={(e) => setPropForm((f) => ({ ...f, bedrooms: Number(e.target.value) }))}
                    className={inputCls}
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.banosLabel')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={propForm.bathrooms}
                    onChange={(e) => setPropForm((f) => ({ ...f, bathrooms: Number(e.target.value) }))}
                    className={inputCls}
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.superficie')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={propForm.area}
                    onChange={(e) => setPropForm((f) => ({ ...f, area: Number(e.target.value) }))}
                    className={inputCls}
                    style={inputStyle}
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:col-span-2">
                {!isDemoUser && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      {tr('aj.dueño')}
                    </span>
                    <Select
                      value={propForm.ownerId ?? 'none'}
                      onValueChange={(v) => setPropForm((f) => ({ ...f, ownerId: v === 'none' ? null : v }))}
                    >
                      <SelectTrigger className="h-9 w-full rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm shadow-none">
                        <SelectValue placeholder={tr('aj.sinDueño')} />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                        <SelectItem value="none">{tr('aj.sinDueño')}</SelectItem>
                        {data.getUsers().map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
                <label className={`flex flex-col gap-1.5 ${!isDemoUser ? '' : 'sm:col-span-2'}`}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.icalUrl')}
                  </span>
                {editingIcal ? (
                  <span className="flex items-center gap-2">
                    <input
                      value={propForm.icalUrl}
                      onChange={(e) => {
                        setPropForm((f) => ({ ...f, icalUrl: e.target.value }));
                        setIcalCheck({ state: 'idle' });
                      }}
                      autoFocus
                      className={cn(inputCls, 'min-w-0 flex-1')}
                      style={inputStyle}
                    />
                    <button
                      type="button"
                      disabled={!propForm.icalUrl.trim() || icalCheck.state === 'checking'}
                      onClick={() => void verifyIcal(propForm.icalUrl.trim())}
                      className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)] disabled:opacity-40"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', icalCheck.state === 'checking' && 'animate-spin')} />
                      {icalCheck.state === 'checking' ? tr('aj.verificando') : tr('aj.verificar')}
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium"
                      style={{ color: propForm.icalUrl ? 'var(--text)' : 'var(--text-faint)' }}
                    >
                      {propForm.icalUrl ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <Ban className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                      )}
                      {propForm.icalUrl ? tr('aj.icalConfigurada') : tr('aj.icalSinConfigurar')}
                    </span>
                    <button
                      type="button"
                      onClick={startEditIcal}
                      className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors hover:brightness-110"
                      style={{ borderColor: 'rgb(244 63 94 / 0.4)', color: '#F43F5E' }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {tr('aj.editar')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void verifyIcal(propForm.icalUrl)}
                      disabled={!propForm.icalUrl.trim() || icalCheck.state === 'checking'}
                      className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)] disabled:opacity-40"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', icalCheck.state === 'checking' && 'animate-spin')} />
                      {icalCheck.state === 'checking' ? tr('aj.verificando') : tr('aj.verificar')}
                    </button>
                  </span>
                )}
                {icalCheck.state === 'ok' && (
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-500">
                    <Check className="h-3.5 w-3.5" />
                    {tr('aj.icalValida', { count: icalCheck.count ?? 0 })}
                  </span>
                )}
                {icalCheck.state === 'error' && (
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-rose-500">
                    <Ban className="h-3.5 w-3.5" />
                    {icalErrorText()} · {tr('aj.icalAviso')}
                  </span>
                )}
              </label>
              </div>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.checklist')}
                  </span>
                  {fullEditor !== 'checklist' && (
                    <button
                      type="button"
                      onClick={() => setFullEditor('checklist')}
                      className="hidden items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)] lg:flex"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Pencil className="h-3 w-3" />
                      {tr('aj.editar')}
                    </button>
                  )}
                </div>
                {fullEditor === 'checklist' ? (
                  <>
                    <textarea
                      autoFocus
                      value={checklistText}
                      onChange={(e) => setChecklistText(e.target.value)}
                      rows={6}
                      placeholder={tr('aj.checklistPlaceholder')}
                      className="w-full resize-none rounded-xl border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                      style={inputStyle}
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setFullEditor(null)} className="brand-gradient flex h-9 flex-1 items-center justify-center rounded-xl text-sm font-semibold text-white">
                        {tr('common.listos')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setFullEditor('checklist')}
                      className="flex h-10 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors hover:bg-[var(--surface-2)] lg:hidden"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {tr('aj.editarCampo')}
                    </button>
                  </>
                )}
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {tr('aj.checklistNota')}
                </span>
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.instrucciones')}
                  </span>
                  {fullEditor !== 'instrucciones' && (
                    <button
                      type="button"
                      onClick={() => setFullEditor('instrucciones')}
                      className="hidden items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)] lg:flex"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Pencil className="h-3 w-3" />
                      {tr('aj.editar')}
                    </button>
                  )}
                </div>
                {fullEditor === 'instrucciones' ? (
                  <>
                    <textarea
                      autoFocus
                      value={instructionsText}
                      onChange={(e) => setInstructionsText(e.target.value)}
                      rows={5}
                      placeholder={tr('aj.instruccionesPlaceholder')}
                      className="w-full resize-none rounded-xl border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                      style={inputStyle}
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setFullEditor(null)} className="brand-gradient flex h-9 flex-1 items-center justify-center rounded-xl text-sm font-semibold text-white">
                        {tr('common.listos')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setFullEditor('instrucciones')}
                      className="flex h-10 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors hover:bg-[var(--surface-2)] lg:hidden"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {tr('aj.editarCampo')}
                    </button>
                  </>
                )}
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {tr('aj.instruccionesNota')}
                </span>
              </label>
              <button
                type="button"
                onClick={saveProp}
                className="brand-gradient mt-1 flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] sm:col-span-2"
              >
                {tr('aj.guardar')}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ============================== Dialog recorte de foto (4:3 → WebP) */}
      {cropFile && (
        <PhotoCropDialog
          file={cropFile}
          open={!!cropFile}
          onClose={() => setCropFile(null)}
          onSave={uploadCroppedPhoto}
        />
      )}

    </div>
  );
}