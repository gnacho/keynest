import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Ban, CalendarOff, Check, ChevronsRight, Link2, Settings2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import MoneyText from '@/components/MoneyText';
import PersonAvatar from '@/components/PersonAvatar';
import PropertyAvatar from '@/components/PropertyAvatar';
import StatusBadge from '@/components/StatusBadge';
import AssignPopover from '@/components/tareas/AssignPopover';
import { catIcon } from '@/lib/cat-icons';
import { getFreeWindow } from '@/components/tareas/free-window';
import { useBelowLg } from '@/components/tareas/use-below-lg';
import { copyText } from '@/lib/clipboard';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import type { MaintenanceTask } from '@/data/types';
import { fmtDateShort, isSameDay } from '@/lib/format';
import { chipStyle } from '@/lib/semantic';
import { cn } from '@/lib/utils';

/* ------------------------------------------- Pista "deslizar para finalizar" */
function SwipeToFinish({ onDone, children }: { onDone: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [finishing, setFinishing] = useState(false);
  const x = useMotionValue(0);
  const trackOpacity = useTransform(x, [0, 100], [0.4, 1]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.offsetWidth);
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const finish = () => {
    if (finishing) return;
    setFinishing(true);
    try {
      navigator.vibrate?.(25);
    } catch {
      /* noop */
    }
    window.setTimeout(onDone, 320);
  };

  return (
    <div ref={ref} className="relative overflow-hidden rounded-2xl">
      {/* Pista: gradiente slate → emerald + chevrons animados */}
      <motion.div
        style={{ opacity: trackOpacity }}
        className="absolute inset-0 flex items-center justify-end gap-1.5 rounded-2xl bg-gradient-to-r from-slate-400 to-emerald-500 pr-4"
      >
        <span className="text-xs font-semibold text-white">{t('mant.desliza')}</span>
        <motion.span
          animate={reduce ? undefined : { x: [0, 8, 0] }}
          transition={reduce ? undefined : { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronsRight className="h-4 w-4 text-white" />
        </motion.span>
      </motion.div>

      {/* Flash emerald al superar el umbral */}
      <AnimatePresence>
        {finishing && (
          <motion.div
            initial={{ opacity: 0.65 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="pointer-events-none absolute inset-0 z-10 rounded-2xl bg-emerald-500"
          />
        )}
      </AnimatePresence>

      <motion.div
        style={{ x }}
        drag={finishing ? false : 'x'}
        dragConstraints={{ left: 0, right: width }}
        dragElastic={0.1}
        dragTransition={{ bounceStiffness: 500, bounceDamping: 35 }}
        onDragEnd={(_, info) => {
          if (info.offset.x > width * 0.4) finish();
        }}
        animate={finishing && !reduce ? { scale: [1, 1.02, 1] } : { scale: 1 }}
        transition={{ duration: 0.3 }}
        className="relative rounded-2xl"
      >
        {children}
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ Tarjeta */
interface MaintenanceCardProps {
  task: MaintenanceTask;
  variants: Variants;
  animateEntry?: boolean;
  onFinished: () => void;
  onEdit?: () => void;
}

export default function MaintenanceCard({ task: t, variants, animateEntry = true, onFinished, onEdit }: MaintenanceCardProps) {
  const { t: tr } = useTranslation();
  const data = useData();
  const belowLg = useBelowLg();
  const [notesOpen, setNotesOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const property = data.getProperty(t.propertyId)!;
  const assignee = t.assigneeId ? data.getPerson(t.assigneeId) : undefined;
  const assignedUser = t.assignedUserId ? data.getUsers().find((u) => u.id === t.assignedUserId) : undefined;
  const maintPeople = useMemo(() => data.getPeople().filter((p) => p.role === 'proveedor'), [data]);
  const maintUsers = useMemo(() => data.getUsers(), [data]);
  const catMeta = data.getCategories().find((c) => c.key === t.category);
  const cat = { icon: catIcon(catMeta?.icon ?? 'wrench'), label: catMeta?.label ?? t.category };

  // Ventana de desocupación computada del calendario de reservas
  const free = useMemo(
    () => getFreeWindow(data, t.propertyId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, t.propertyId, data.version],
  );

  const finish = () => {
    data.setMaintenanceStatus(t.id, 'finalizada');
    onFinished();
  };

  const freeLine = (() => {
    if (!free) return null;
    if (t.urgent && free.nextCheckIn) {
      return (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-500">
          <CalendarOff className="h-3.5 w-3.5 shrink-0" />
          {tr('mant.irAntesDe', { date: fmtDateShort(free.nextCheckIn) })}
        </p>
      );
    }
    return (
      <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
        <CalendarOff className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} />
        {isSameDay(free.start, new Date()) ? tr('mant.libreDesdeHoy') : tr('mant.libreDesde', { date: fmtDateShort(free.start) })} ·{' '}
        {tr('mant.dias', { count: free.days })}
      </p>
    );
  })();

  const card = (
    <motion.div
      layout="position"
      variants={animateEntry ? variants : undefined}
      initial={animateEntry ? undefined : false}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className={cn(
        'card flex flex-col gap-2 p-3.5',
        t.urgent && t.status !== 'finalizada' && 'border-2 border-rose-300 dark:border-rose-500/60',
      )}
    >
      {/* Fila 1: título + urgente */}
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold leading-5">
          {t.urgent && t.status !== 'finalizada' && (
            <span className="h-2 w-2 shrink-0 animate-dot-pulse rounded-full bg-rose-500" />
          )}
          {t.title}
        </p>
        <div className="flex items-center gap-1">
          {t.urgent && t.status !== 'finalizada' && <StatusBadge label={tr('mant.urgente')} tone="rose" />}
          {!data.isDemo && onEdit && t.status !== 'finalizada' && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={tr('mant.editarTarea')}
              className="group flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: 'var(--text-faint)' }}
            >
              <Settings2 className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
            </button>
          )}
        </div>
      </div>

      {/* Fila 2: inmueble + categoría + etiqueta de gasto */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
          <PropertyAvatar property={property} size={24} className="rounded-lg" />
          {property.name}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={chipStyle('slate')}
        >
          <cat.icon className="h-3 w-3" />
          {cat.label}
        </span>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={chipStyle('rose')}
        >
          {t.expenseTag}
        </span>
        {t.scheduledDate && t.status !== 'finalizada' && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={chipStyle('blue')}
          >
            {tr('mant.prevista', { date: fmtDateShort(t.scheduledDate) })}
          </span>
        )}
      </div>

      {/* Fila 3: contexto de desocupación */}
      {freeLine}

      {/* Notas truncadas a 2 líneas */}
      <p
        className={cn('text-[13px] leading-[1.4]', !notesOpen && 'line-clamp-2')}
        style={{ color: 'var(--text-muted)' }}
      >
        {t.notes}{' '}
        {!notesOpen && (
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            className="font-semibold text-[#6366F1] hover:underline"
          >
            {tr('mant.mas')}
          </button>
        )}
      </p>

      {/* Checks de la orden: progreso visible en la tarjeta */}
      {(t.checks?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
            {tr('mant.checksProgreso', { done: (t.checks ?? []).filter((k) => k.done).length, total: (t.checks ?? []).length })}
          </p>
          <div className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--surface-2)' }}>
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${(((t.checks ?? []).filter((k) => k.done).length) / ((t.checks ?? []).length || 1)) * 100}%` }}
            />
          </div>
          {(t.checks ?? []).slice(0, notesOpen ? undefined : 3).map((k) => (
            <span key={k.id} className={cn('flex items-center gap-1.5 text-xs', k.done && 'line-through opacity-60')} style={{ color: 'var(--text-muted)' }}>
              <span className={cn('h-1.5 w-1.5 rounded-full', k.done ? 'bg-emerald-500' : '')} style={k.done ? undefined : { backgroundColor: 'var(--border)' }} />
              {k.label}
            </span>
          ))}
        </div>
      )}

      {/* Asignación + acciones por estado */}
      <div className="mt-0.5 flex items-center justify-between gap-2">
        {!data.isDemo && (
          <button
            type="button"
            aria-label={tr('mant.compartirOrden')}
            title={tr('mant.compartirOrden')}
            onClick={async () => {
              const path = await data.generateMaintenanceToken(t.id);
              if (path) {
                const ok = await copyText(`${window.location.origin}${path}`);
                toast.success(ok ? tr('mant.enlaceCopiado') : tr('mant.enlaceGenerado', { url: `${window.location.origin}${path}` }));
              }
            }}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-2)]',
              t.hasToken ? 'text-[#6366F1]' : '',
            )}
            style={t.hasToken ? undefined : { color: 'var(--text-faint)' }}
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
        )}
        {!data.isDemo && t.hasToken && (
          <button
            type="button"
            aria-label={tr('mant.revocarEnlace')}
            title={tr('mant.revocarEnlace')}
            onClick={() => {
              void data.revokeMaintenanceToken(t.id);
              toast.success(tr('mant.enlaceRevocado'));
            }}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--ro-chip-bg)]"
            style={{ color: 'var(--text-faint)' }}
          >
            <Ban className="h-3.5 w-3.5" />
          </button>
        )}
        {assignedUser ? (
          <span className="flex items-center gap-2">
            <PersonAvatar name={assignedUser.name} initials={assignedUser.name.charAt(0).toUpperCase()} size={26} />
            <span className="text-xs font-semibold">{assignedUser.name}</span>
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {tr('aj.rol' + (assignedUser.role === 'admin' ? 'Admin' : 'User'))}
            </span>
            {!data.isDemo && (
              <AssignPopover
                people={maintPeople}
                users={maintUsers}
                tone="blue"
                variant="icon"
                onSelect={(id) => data.assignMaintenance(t.id, id)}
                onSelectUser={(id) => data.assignUserToMaintenance(t.id, id)}
              />
            )}
          </span>
        ) : assignee ? (
          <span className="flex items-center gap-2">
            <PersonAvatar name={assignee.name} initials={assignee.initials} size={26} />
            <span className="text-xs font-semibold">{assignee.name}</span>
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {assignee.hourlyRate} €/h
            </span>
            {!data.isDemo && (
              <AssignPopover
                people={maintPeople}
                users={maintUsers}
                tone="blue"
                variant="icon"
                onSelect={(id) => data.assignMaintenance(t.id, id)}
                onSelectUser={(id) => data.assignUserToMaintenance(t.id, id)}
              />
            )}
          </span>
        ) : (
          !data.isDemo && (
            <AssignPopover
              people={maintPeople}
              users={maintUsers}
              tone="blue"
              variant={t.status === 'nueva' ? 'button' : 'dashed'}
              label={t.status === 'nueva' ? tr('mant.asignar') : `+ ${tr('mant.asignar')}`}
              onSelect={(id) => data.assignMaintenance(t.id, id)}
              onSelectUser={(id) => data.assignUserToMaintenance(t.id, id)}
            />
          )
        )}

        {t.status === 'asignada' && !belowLg && !data.isDemo && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="brand-gradient flex h-8 items-center rounded-xl px-3.5 text-xs font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
          >
            {tr('mant.finalizar')}
          </button>
        )}
        {t.status === 'finalizada' && (
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-500">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              {tr('mant.cerrada')}
            </span>
            {t.cost !== undefined && (
              <MoneyText value={t.cost} className="text-xs font-semibold text-rose-500" />
            )}
            {!data.isDemo && (
              <button
                type="button"
                onClick={() => data.setMaintenanceStatus(t.id, (t.assigneeId || t.assignedUserId) ? 'asignada' : 'nueva')}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: 'var(--text-faint)' }}
              >
                <Undo2 className="h-3 w-3" />
                {tr('mant.reabrir')}
              </button>
            )}
          </span>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={tr('mant.confirmTitulo')}
        description={tr('mant.confirmDesc', { title: t.title })}
        confirmLabel={tr('mant.finalizar')}
        onConfirm={finish}
      />
    </motion.div>
  );

  // Gesto clave en móvil: deslizar para finalizar (umbral 40 %)
  if (t.status === 'asignada' && belowLg && !data.isDemo) {
    return <SwipeToFinish onDone={finish}>{card}</SwipeToFinish>;
  }
  return card;
}
