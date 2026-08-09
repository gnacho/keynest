import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Check, ChevronDown, ClipboardList, Phone, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import CleaningPhotos from '@/components/tareas/CleaningPhotos';
import PhotoLightbox from '@/components/tareas/PhotoLightbox';
import PersonAvatar from '@/components/PersonAvatar';
import PropertyAvatar from '@/components/PropertyAvatar';
import StatusBadge from '@/components/StatusBadge';
import MoneyText from '@/components/MoneyText';
import ConfirmDialog from '@/components/ConfirmDialog';
import AssignPopover from '@/components/tareas/AssignPopover';
import ConfirmCleaningDialog from '@/components/tareas/ConfirmCleaningDialog';
import HoursStepper from '@/components/tareas/HoursStepper';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import type { Cleaning, CleaningStatus, SemColor } from '@/data/types';
import {
  fmtDateShort,
  fmtDateLong,
  fmtMoney,
  fmtMonth,
  fmtNumber,
  fmtTime,
  photoRetentionUntil,
} from '@/lib/format';
import { chipStyle } from '@/lib/semantic';
import { cn } from '@/lib/utils';

const STATUS_LABEL_KEY: Record<CleaningStatus, string> = {
  pendiente: 'estado.pendiente',
  asignada: 'estado.asignada',
  'en-curso': 'estado.enCurso',
  archivada: 'estado.archivada',
};

const STATUS_BORDER: Record<CleaningStatus, string> = {
  pendiente: '#64748B',
  asignada: '#8B5CF6',
  'en-curso': '#3B82F6',
  archivada: '#64748B',
};

/* #68: asignada en verde, pendiente (no asignada) en rojo. */
const STATUS_TONE: Record<CleaningStatus, SemColor> = {
  pendiente: 'rose',
  asignada: 'emerald',
  'en-curso': 'blue',
  archivada: 'slate',
};

interface CleaningCardProps {
  cleaning: Cleaning;
  variants: Variants;
  highlight?: boolean;
  onCompleted: (total: number) => void;
}

/** Tarjeta de tarea de limpieza: el checklist del inmueble es lo primero que se ve. */
export default function CleaningCard({ cleaning: c, variants, highlight = false, onCompleted }: CleaningCardProps) {
  const { t } = useTranslation();
  const data = useData();
  const [editOpen, setEditOpen] = useState(false);
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const property = data.getProperty(c.propertyId)!;
  const reservation = c.reservationId ? data.getReservations().find((r) => r.id === c.reservationId) : undefined;
  const cleaningPeople = useMemo(() => data.getPeople().filter((p) => p.role === 'limpieza'), [data]);

  const [photos, setPhotos] = useState<string[]>(() => [...c.photos]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [photoViewer, setPhotoViewer] = useState<number | null>(null);
  // Edición inline de las instrucciones propias de esta limpieza (no tocan el inmueble)
  const [instrEditing, setInstrEditing] = useState(false);
  const [instrDraft, setInstrDraft] = useState(c.instructions);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // En móvil el cuerpo (checklist, instrucciones, asignación, fotos) se pliega;
  // en desktop siempre visible.
  const [bodyOpen, setBodyOpen] = useState(false);

  const done = c.checks.filter((k) => k.done).length;
  const total = c.checks.length;
  const allDone = total > 0 && done === total;
  const archived = c.status === 'archivada';
  // Elimable: no realizada (pendiente/asignada) y sin horas, productos ni fotos
  const canDelete = !archived
    && (c.status === 'pendiente' || c.status === 'asignada')
    && (c.workLog ?? []).length === 0
    && (c.supplies ?? []).length === 0
    && (c.photos ?? []).length === 0;
  const retention = photoRetentionUntil(c.date);

  useEffect(() => {
    if (highlight && ref.current) {
      ref.current.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
  }, [highlight, reduce]);

  const assignedPeople = c.assigneeIds
    .map((id) => data.getPerson(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const candidates = cleaningPeople.filter((p) => !c.assigneeIds.includes(p.id));
  const cost = archived ? data.getCleaningCost(c) : 0;
  const estimate = c.estimatedHours ?? 2;

  /* ----------------------------------------------------------- Archivada */
  if (archived) {
    return (
      <motion.div
        ref={ref}
        layout="position"
        variants={variants}
        className="card border-l-[3px] p-4 opacity-90"
        style={{ borderLeftColor: STATUS_BORDER[c.status] }}
      >
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <PropertyAvatar property={property} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{property.name}</span>
            <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              {fmtDateShort(c.date)} · {assignedPeople.map((p) => p.name).join(' + ') || '—'} ·{' '}
              <MoneyText value={cost} className="text-xs font-semibold text-rose-500" /> · {t('tareas.fotos', { count: photos.length })}
            </span>
          </span>
          <StatusBadge label={t(STATUS_LABEL_KEY[c.status])} />
          <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="h-4 w-4" style={{ color: 'var(--text-faint)' }} />
          </motion.span>
        </button>
        {expanded && !data.isDemo && (
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="flex h-8 items-center rounded-xl border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              {t('tareas.editar')}
            </button>
            <button
              type="button"
              onClick={() => data.setCleaningStatus(c.id, c.assigneeIds.length > 0 ? 'asignada' : 'pendiente')}
              className="flex h-8 items-center rounded-xl border border-violet-400 px-3 text-xs font-semibold text-violet-500 transition-colors hover:bg-[var(--vi-chip-bg)]"
            >
              {t('tareas.reabrir')}
            </button>
          </div>
        )}

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="mt-3 flex flex-col gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                {/* Desglose del coste */}
                <div className="flex flex-col gap-1.5 text-[13px]">
                  {(c.workLog ?? []).map((w) => {
                    const p = data.getPerson(w.personId);
                    if (!p) return null;
                    return (
                      <p key={w.personId} className="flex items-center justify-between gap-2">
                        <span style={{ color: 'var(--text-muted)' }}>
                          {p.name} · {fmtNumber(w.hours, 1)} h × {fmtMoney(p.hourlyRate, true)}/h
                        </span>
                        <span className="tnum font-display font-medium">{fmtMoney(w.hours * p.hourlyRate, true)}</span>
                      </p>
                    );
                  })}
                  {(c.supplies ?? []).map((s, i) => (
                    <p key={`${s.label}-${i}`} className="flex items-center justify-between gap-2">
                      <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                      <span className="tnum font-display font-medium">{fmtMoney(s.amount, true)}</span>
                    </p>
                  ))}
                  <p className="flex items-center justify-between gap-2 border-t pt-1.5" style={{ borderColor: 'var(--border)' }}>
                    <span className="font-semibold">{t('tareas.costeTotal')}</span>
                    <MoneyText value={cost} className="font-semibold text-rose-500" />
                  </p>
                </div>

                {/* Checks realizados */}
                <div className="flex flex-wrap gap-1.5">
                  {c.checks.map((k) => (
                    <span
                      key={k.id}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={chipStyle('emerald')}
                    >
                      <Check className="h-3 w-3" />
                      {k.label}
                    </span>
                  ))}
                </div>

                {/* Fotos con retención de 1 mes */}
                {photos.length > 0 ? (
                  <div>
                    <div className="flex flex-wrap gap-2">
                      {photos.map((src, i) => (
                        <button
                          key={`${src}-${i}`}
                          type="button"
                          onClick={() => setPhotoViewer(i)}
                          aria-label={t('tareas.verFoto', { n: i + 1 })}
                          className="block h-16 w-16 overflow-hidden rounded-xl border transition-transform duration-150 hover:-translate-y-0.5"
                          style={{ borderColor: 'var(--border)' }}
                        >
                          <img
                            src={src}
                            alt={t('tareas.foto', { n: i + 1 })}
                            className="h-full w-full object-cover"
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="%2394a3b8"><rect width="64" height="64" rx="8" fill="%23eef1f6"/><text x="32" y="38" text-anchor="middle" font-size="24">?</text></svg>'; }}
                          />
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      {t('tareas.retencionHasta', { date: fmtDateLong(retention) })}
                    </p>
                  </div>
                ) : new Date() > retention ? (
                  <p className="text-[12px] italic" style={{ color: 'var(--text-faint)' }}>
                    {t('tareas.fotosEliminadas')}
                  </p>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <PhotoLightbox photos={photos} index={photoViewer} onIndexChange={setPhotoViewer} />

        <ConfirmCleaningDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          people={assignedPeople}
          propertyName={property.name}
          estimatedHours={c.estimatedHours ?? 2}
          initialWorkLog={c.workLog}
          initialSupplies={c.supplies}
          confirmLabel={t('tareas.guardarCambios')}
          onConfirm={(workLog, supplies) => {
            void data.updateCleaning(c.id, workLog, supplies);
          }}
        />
      </motion.div>
    );
  }

  /* ------------------------------------------- Pendiente / asignada / en curso */
  return (
    <motion.div
      ref={ref}
      layout="position"
      variants={variants}
      animate={
        highlight && !reduce
          ? { boxShadow: ['0 0 0 0 rgb(99 102 241 / 0.5)', '0 0 0 6px rgb(99 102 241 / 0)'] }
          : undefined
      }
      transition={highlight && !reduce ? { duration: 1.2, ease: 'easeOut' } : { duration: 0.3 }}
      className="card min-w-0 overflow-hidden border-l-[3px] p-4"
      style={{
        borderLeftColor: STATUS_BORDER[c.status],
      }}
    >
      {/* Cabecera: información esencial + progreso + trigger de expand (móvil) */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PropertyAvatar property={property} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{property.name}</p>
            <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              {property.address}
            </p>
            {/* Progreso del checklist: siempre visible */}
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--border)' }}>
                <motion.div
                  className="h-full rounded-full bg-violet-500"
                  initial={false}
                  animate={{ width: `${total ? (done / total) * 100 : 0}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <span className="tnum shrink-0 text-xs font-semibold text-violet-500">{done}/{total}</span>
            </div>
          </div>
        </div>
        {/* Fecha de la limpieza grande (chip calendario, estilo #24) + hora */}
          <span
            className="flex items-center gap-2 rounded-lg border px-2 py-1 leading-none"
            style={{ borderColor: 'rgb(139 92 246 / 0.25)', backgroundColor: 'rgb(139 92 246 / 0.08)' }}
          >
            <span className="text-[11px] font-semibold tnum" style={{ color: '#8B5CF6' }}>
              {fmtTime(c.date)}
            </span>
            <span className="flex flex-col items-end">
              <span className="text-xl font-bold" style={{ color: '#8B5CF6' }}>
                {c.date.getDate()}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#8B5CF6' }}>
                {fmtMonth(c.date, true)}
              </span>
            </span>
          </span>
      </div>

      {/* Meta: estado + reserva origen + trigger de expand (móvil) */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <StatusBadge label={t(STATUS_LABEL_KEY[c.status])} tone={STATUS_TONE[c.status]} dot={c.status === 'en-curso'} pulse={c.status === 'en-curso'} />
        {reservation && (
          <Link
            to={`/reservas?inmueble=${property.slug}&reserva=${reservation.id}`}
            className="text-xs font-medium text-violet-500 hover:underline"
          >
            {t('tareas.reservaDe', { name: reservation.guest.name })}
          </Link>
        )}
        <button
          type="button"
          onClick={() => setBodyOpen((o) => !o)}
          aria-expanded={bodyOpen}
          className="ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors lg:hidden"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          {t('tareas.detalles')}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', bodyOpen && 'rotate-180')} />
        </button>
      </div>

      {/* Cuerpo: en móvil colapsable, en desktop siempre visible */}
      <div className={cn('mt-3 flex flex-col gap-3', !bodyOpen && 'hidden lg:flex')}>
        {/* 1) CHECKLIST DEL INMUEBLE — lo primero que mira la persona de limpieza */}
        <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
          <p
            className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: 'var(--text-faint)' }}
          >
            {t('tok.checklist', { name: property.name })}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {c.checks.map((k) => {
              const checkInner = (
                <>
                  <span
                    className={cn(
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-all duration-150',
                      k.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'text-transparent',
                    )}
                    style={k.done ? undefined : { borderColor: 'var(--border)' }}
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span className={cn(k.done && 'line-through opacity-60')}>{k.label}</span>
                </>
              );
              return data.isDemo ? (
                <span key={k.id} className="flex cursor-default items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[13px]">
                  {checkInner}
                </span>
              ) : (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => data.toggleCleaningCheck(c.id, k.id)}
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] transition-colors duration-150 hover:bg-[var(--surface)]"
                >
                  {checkInner}
                </button>
              );
            })}
          </div>
          <AnimatePresence>
            {allDone && c.status === 'en-curso' && (
              <motion.span
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 500, damping: 25 }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={chipStyle('emerald')}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('tareas.listaParaConfirmar')}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* 2) Instrucciones de la limpieza — snapshot heredado del inmueble, editable
              aquí sin tocar el maestro. Las personas de limpieza las ven (solo lectura). */}
        <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
              <ClipboardList className="h-3.5 w-3.5 text-violet-500" />
              {t('tareas.instruccionesLimpieza')}
            </p>
            {!data.isDemo && !instrEditing && (
              <button
                type="button"
                onClick={() => { setInstrDraft(c.instructions); setInstrEditing(true); }}
                className="flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors hover:bg-[var(--surface)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                {c.instructions ? <Pencil className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                {c.instructions ? t('tareas.editarInstrucciones') : t('tareas.anadirInstrucciones')}
              </button>
            )}
          </div>
          {instrEditing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={instrDraft}
                onChange={(e) => setInstrDraft(e.target.value)}
                rows={4}
                placeholder={t('tareas.instruccionesPlaceholder')}
                className="w-full resize-y rounded-xl border bg-[var(--surface)] p-2.5 text-[13px] leading-[1.5] outline-none focus:border-violet-400"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              />
              <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {t('tareas.instruccionesAyuda')}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInstrEditing(false)}
                  className="flex h-8 items-center rounded-xl border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                >
                  {t('common.cancelar')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await data.updateCleaningInstructions(c.id, instrDraft);
                    setInstrEditing(false);
                  }}
                  className="flex h-8 items-center rounded-xl bg-violet-500 px-3 text-xs font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
                >
                  {t('common.guardar')}
                </button>
              </div>
            </div>
          ) : c.instructions ? (
            <p className="whitespace-pre-line text-[13px] leading-[1.55]" style={{ color: 'var(--text)' }}>
              {c.instructions}
            </p>
          ) : (
            <p className="text-[12px] italic" style={{ color: 'var(--text-faint)' }}>
              {data.isDemo ? t('tareas.sinInstrucciones') : t('tareas.sinInstruccionesAnadir')}
            </p>
          )}
        </div>

        {/* 3) Asignación (hasta 2 personas) + previsión de horas */}
        <div>
          <p
            className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: 'var(--text-faint)' }}
          >
            {t('tareas.asignacion')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {assignedPeople.map((p) => (
              <motion.span
                key={p.id}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 500, damping: 30 }}
                className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-2"
                style={{ borderColor: 'var(--border)' }}
              >
                <PersonAvatar name={p.name} initials={p.initials} size={26} />
                <span className="text-xs font-semibold">{p.name}</span>
                <a
                  href={`tel:${p.phone.replace(/\s/g, '')}`}
                  className="flex items-center gap-1 text-[11px]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Phone className="h-3 w-3" />
                  {p.phone}
                </a>
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {p.hourlyRate} €/h
                </span>
                {!data.isDemo && (
                  <button
                    type="button"
                    onClick={() => data.removeCleaningAssignee(c.id, p.id)}
                    aria-label={t('tareas.quitarA', { name: p.name })}
                    className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-2)]"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </motion.span>
            ))}
            {!data.isDemo && c.assigneeIds.length < 2 && (
              <AssignPopover
                people={candidates}
                tone="violet"
                onSelect={(personId) => data.assignCleaning(c.id, personId, estimate)}
              />
            )}
          </div>
          {assignedPeople.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  {t('tareas.previsionHoras')}
                </span>
                {data.isDemo ? (
                  <span className="tnum text-sm font-semibold">{estimate} h</span>
                ) : (
                  <HoursStepper
                    compact
                    value={estimate}
                    onChange={(h) => data.setCleaningEstimate(c.id, h)}
                    ariaLabel="previsión de horas"
                  />
                )}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {t('tareas.horasPorPersona')}
              </span>
            </div>
          )}
        </div>

        {/* 4) Fotos reales (galería/cámara) + retención */}
        <div>
          <CleaningPhotos
            photos={photos}
            readOnly={data.isDemo}
            onUpload={async (file) => {
              const next = await data.uploadCleaningPhoto(c.id, file);
              if (next) setPhotos(next);
              return next;
            }}
            onRemove={(url) => {
              const next = photos.filter((x) => x !== url);
              setPhotos(next);
              void data.updateCleaningPhotos(c.id, next);
            }}
          />
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
            {t('tareas.retencion')}
          </p>
        </div>

        {/* Acciones de estado: confirmar directo (sin paso intermedio "iniciar") */}
        <div className="flex items-center justify-end gap-2">
          {!data.isDemo && canDelete && (
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="mr-auto flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold text-rose-500 transition-colors hover:bg-[var(--ro-chip-bg)]"
              style={{ borderColor: 'rgb(244 63 94 / 0.5)' }}
            >
              <Trash2 className="h-4 w-4" />
              {t('tareas.eliminar')}
            </button>
          )}
          {!data.isDemo && (c.status === 'asignada' || c.status === 'en-curso') && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="flex h-9 items-center rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
            >
              {t('tareas.confirmar')}
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('tareas.eliminarTitulo')}
        description={t('tareas.eliminarDesc')}
        tone="danger"
        confirmLabel={t('tareas.eliminar')}
        onConfirm={() => { void data.deleteCleaning(c.id); }}
      />

      <ConfirmCleaningDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        people={assignedPeople}
        propertyName={property.name}
        estimatedHours={estimate}
        onConfirm={(workLog, supplies, totalCost) => {
          data.completeCleaning(c.id, workLog, supplies);
          const products = supplies.reduce((acc, s) => acc + s.amount, 0);
          if (products > 0) {
            data.addExpense({
              propertyId: c.propertyId,
              type: 'extras',
              label: t('tareas.productosLimpieza', { name: property.name }),
              amount: Math.round(products * 100) / 100,
              month: c.date.getMonth(),
              year: c.date.getFullYear(),
            });
          }
          onCompleted(totalCost);
        }}
      />
    </motion.div>
  );
}
