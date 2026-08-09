import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import {
  BatteryFull,
  BatteryMedium,
  BatteryWarning,
  Crown,
  Lock,
  RefreshCw,
  Smartphone,
  Sparkles,
  TriangleAlert,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import FilterBar from '@/components/FilterBar';
import StatusBadge from '@/components/StatusBadge';
import PersonAvatar from '@/components/PersonAvatar';
import PropertyAvatar from '@/components/PropertyAvatar';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import type { Lock as LockT, TedeeAccess } from '@/data/types';
import { fmtDateShort, fmtRelative, fmtTime, isSameDay, startOfDay, addDays } from '@/lib/format';
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

const timelineV: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const eventV: Variants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE_OUT_QUART } },
};

const TYPE_META: Record<TedeeAccess['type'], { labelKey: string; color: string; actionKey: string }> = {
  entrada: { labelKey: 'ted.entrada', color: '#10B981', actionKey: 'ted.accionEntrada' },
  salida: { labelKey: 'ted.salida', color: '#F97316', actionKey: 'ted.accionSalida' },
  remota: { labelKey: 'ted.remota', color: '#3B82F6', actionKey: 'ted.accionRemota' },
};

const ROLE_META: Record<TedeeAccess['actorRole'], { labelKey: string; icon: typeof UserRound; color: string }> = {
  huésped: { labelKey: 'ted.huesped', icon: UserRound, color: 'var(--text-muted)' },
  limpieza: { labelKey: 'ted.limpieza', icon: Sparkles, color: '#8B5CF6' },
  propietario: { labelKey: 'ted.propietario', icon: Crown, color: '#6366F1' },
};

function batteryTone(pct: number): { color: string; icon: typeof BatteryFull } {
  if (pct > 60) return { color: '#10B981', icon: BatteryFull };
  if (pct >= 30) return { color: '#F59E0B', icon: BatteryMedium };
  return { color: '#F43F5E', icon: BatteryWarning };
}



/* ------------------------------------------------------------ Tarjeta cerradura */
function LockCard({
  lock,
  index,
  refreshKey,
  highlighted,
  onOpen,
  onBatteryTask,
}: {
  lock: LockT;
  index: number;
  refreshKey: number;
  highlighted: boolean;
  onOpen: () => void;
  onBatteryTask: () => void;
}) {
  const { t } = useTranslation();
  const { getProperty } = useData();
  const reduce = useReducedMotion();
  const property = getProperty(lock.propertyId)!;
  const tone = batteryTone(lock.battery);
  const lowBattery = lock.battery < 30;
  const BatteryIcon = tone.icon;

  return (
    <motion.button
      type="button"
      variants={itemV}
      onClick={onOpen}
      data-lock-id={lock.id}
      className={cn(
        'card flex h-full w-full flex-col gap-3 p-4 text-left transition-shadow duration-200 hover:shadow-overlay',
        highlighted && 'ring-2 ring-[#6366F1]',
      )}
      style={!lock.online || lowBattery ? { border: '1.5px solid #F43F5E' } : undefined}
    >
      <div className="flex items-center gap-2.5">
        <PropertyAvatar property={property} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{property.name}</span>
          <span className="block truncate text-[11px]" style={{ color: 'var(--text-faint)' }}>
            {lock.name}
          </span>
        </span>
        {/* Dot conexión: re-pulsa al refrescar (delay escalonado) */}
        <motion.span
          key={refreshKey}
          initial={reduce ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: index * 0.09, duration: 0.3, ease: EASE_OUT_QUART }}
        >
          <StatusBadge
            label={lock.online ? 'Online' : 'Offline'}
            dot
            pulse={lock.online}
            className="px-2 py-0 text-[10px]"
          />
        </motion.span>
      </div>

      <div className="flex items-center gap-3">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--surface-2)' }}
        >
          {lock.online ? (
            <Lock className="h-7 w-7" style={{ color: '#10B981' }} strokeWidth={1.8} />
          ) : (
            <WifiOff className="h-7 w-7" style={{ color: '#64748B' }} strokeWidth={1.8} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            {lock.online ? t('ted.puertaPrincipal') : t('ted.sinConexion', { time: fmtRelative(lock.lastSeen) })}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <BatteryIcon className="h-4 w-4 shrink-0" style={{ color: tone.color }} />
            <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--surface-2)' }}>
              <motion.span
                className="block h-full rounded-full"
                style={{ backgroundColor: tone.color }}
                initial={reduce ? { width: `${lock.battery}%` } : { width: 0 }}
                animate={{ width: `${lock.battery}%` }}
                transition={{ delay: 0.2 + index * 0.07, duration: 0.7, ease: EASE_OUT_QUART }}
              />
            </span>
            <span className="font-display tnum text-[15px] font-semibold" style={{ color: tone.color }}>
              {lock.battery} %
            </span>
          </div>
        </div>
      </div>

      {lowBattery && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onBatteryTask();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              onBatteryTask();
            }
          }}
          className="inline-flex items-center justify-center gap-1.5 self-start rounded-full px-3 py-1 text-[11px] font-semibold transition-transform duration-100 active:scale-95"
          style={{ backgroundColor: 'var(--ro-chip-bg)', color: 'var(--ro-chip-text)' }}
        >
          <BatteryWarning className="h-3.5 w-3.5" />
          {t('ted.crearTareaPilas')}
        </span>
      )}
    </motion.button>
  );
}

/* ------------------------------------------------------------------ Página */
export default function Tedee() {
  const { t } = useTranslation();
  const data = useData();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [params] = useSearchParams();

  const inmueble = params.get('inmueble') ?? 'todos';
  const tipo = params.get('tipo') ?? 'todos';

  const dayLabel = (d: Date): string => {
    const today = startOfDay(new Date());
    if (isSameDay(d, today)) return t('ted.hoy');
    if (isSameDay(d, addDays(today, -1))) return t('ted.ayer');
    return fmtDateShort(d);
  };
  const timeLabel = (d: Date): string => {
    const today = startOfDay(new Date());
    if (isSameDay(d, today)) return `${t('ted.hoy').toLowerCase()} ${fmtTime(d)}`;
    if (isSameDay(d, addDays(today, -1))) return `${t('ted.ayer').toLowerCase()} ${fmtTime(d)}`;
    return `${fmtDateShort(d)} ${fmtTime(d)}`;
  };

  const locks = data.getLocks();
  const onlineCount = locks.filter((l) => l.online).length;

  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [detailLock, setDetailLock] = useState<LockT | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [extraAccesses, setExtraAccesses] = useState<TedeeAccess[]>([]);
  const [visibleCount, setVisibleCount] = useState(8);
  const [highlightLock, setHighlightLock] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Deep-link desde notificaciones: ?lock=<id> resalta esa cerradura un instante.
  useEffect(() => {
    const lockId = params.get('lock');
    if (!lockId) return;
    setHighlightLock(lockId);
    const t = setTimeout(() => setHighlightLock(null), 1400);
    return () => clearTimeout(t);
  }, [params]);

  const problemLocks = locks.filter((l) => !l.online || l.battery < 30);

  const allAccesses = useMemo(() => {
    const combined = [...extraAccesses, ...data.getTedeeAccess()];
    return combined
      .filter((a) => {
        if (inmueble !== 'todos' && data.getProperty(a.propertyId)?.slug !== inmueble) return false;
        if (tipo !== 'todos' && a.type !== tipo) return false;
        return true;
      })
      .sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [data, extraAccesses, inmueble, tipo]);

  const visible = allAccesses.slice(0, visibleCount);

  // Agrupación por día
  const groups = useMemo(() => {
    const out: { label: string; items: TedeeAccess[] }[] = [];
    for (const a of visible) {
      const label = dayLabel(a.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(a);
      else out.push({ label, items: [a] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const refresh = () => {
    if (spinning) return;
    setSpinning(true);
    setTimeout(() => {
      setRefreshKey((k) => k + 1);
      setSpinning(false);
      toast.success(t('ted.actualizado'));
    }, 700);
  };

  const scrollToLock = (lockId: string) => {
    const el = document.querySelector(`[data-lock-id="${lockId}"]`);
    el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    setHighlightLock(lockId);
    setTimeout(() => setHighlightLock(null), 1400);
  };

  const openNow = () => {
    if (!detailLock) return;
    setConfirmOpen(false);
    setOpening(true);
    setTimeout(() => {
      const now = new Date();
      setExtraAccesses((prev) => [
        {
          id: `acc-extra-${now.getTime()}`,
          at: now,
          actorName: t('ted.tu', { name: 'Keynest' }),
          actorRole: 'propietario',
          type: 'remota',
          propertyId: detailLock.propertyId,
          lockId: detailLock.id,
        },
        ...prev,
      ]);
      setOpening(false);
      setDetailLock(null);
      setVisibleCount((c) => c + 1);
      toast.success(t('ted.puertaAbierta'));
      listRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }, 800);
  };

  const detailAccesses = detailLock
    ? allAccesses.filter((a) => a.lockId === detailLock.id).slice(0, 6)
    : [];
  const detailProperty = detailLock ? data.getProperty(detailLock.propertyId) : undefined;

  return (
    <div className="flex flex-col gap-6">

      {/* ============================== Topbar */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {t('ted.subtitulo', { online: onlineCount, total: locks.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          <RefreshCw className={cn('h-4 w-4', spinning && 'animate-spin')} style={{ color: 'var(--text-muted)' }} />
          <span className="hidden sm:inline">{t('ted.actualizar')}</span>
        </button>
      </div>

      <FilterBar
        typeOptions={[
          { value: 'entrada', label: t('ted.entrada') },
          { value: 'salida', label: t('ted.salida') },
          { value: 'remota', label: t('ted.remota') },
        ]}
      />

      {/* ============================== Banner offline */}
      {problemLocks.length > 0 && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE_OUT_QUART }}
          className="flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3"
          style={{ backgroundColor: 'rgb(245 158 11 / 0.1)', borderColor: 'rgb(245 158 11 / 0.3)' }}
        >
          <TriangleAlert className="h-5 w-5 shrink-0" style={{ color: '#F59E0B' }} />
          <p className="min-w-0 flex-1 text-sm font-medium">
            {t('ted.necesitaAtencion', { count: problemLocks.length })}:{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              {problemLocks
                .map((l) => {
                  const p = data.getProperty(l.propertyId)!;
                  const reasons = [!l.online && 'offline', l.battery < 30 && t('ted.bateriaPct', { pct: l.battery })]
                    .filter(Boolean)
                    .join(' · ');
                  return `${p.name} (${reasons})`;
                })
                .join(', ')}
            </span>
          </p>
          <button
            type="button"
            onClick={() => scrollToLock(problemLocks[0].id)}
            className="rounded-full px-3 py-1 text-xs font-semibold text-white transition-transform duration-100 active:scale-95"
            style={{ backgroundColor: '#F59E0B' }}
          >
            {t('ted.ver')}
          </button>
        </motion.div>
      )}

      {/* ============================== Estado de cerraduras */}
      <motion.section variants={containerV} initial="hidden" animate="show" aria-label="Estado de cerraduras">
        <div className="snap-carousel -mx-4 flex gap-3 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 xl:grid-cols-5">
          {locks.map((lock, i) => (
            <div key={lock.id} className="w-[62%] shrink-0 sm:w-[46%] lg:w-auto">
              <LockCard
                lock={lock}
                index={i}
                refreshKey={refreshKey}
                highlighted={highlightLock === lock.id}
                onOpen={() => setDetailLock(lock)}
                onBatteryTask={() => {
                  const p = data.getProperty(lock.propertyId)!;
                  toast.success(t('ted.tareaPilasCreada', { name: p.name }));
                  navigate(`/mantenimiento?inmueble=${p.slug}`);
                }}
              />
            </div>
          ))}
        </div>
      </motion.section>

      {/* ============================== Registro de accesos */}
      <section ref={listRef} className="card scroll-mt-20 p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em]">{t('ted.registro')}</h2>
          <span className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>
            {t('ted.eventos', { count: allAccesses.length })}
          </span>
        </header>

        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('ted.sinAccesos')}
          </p>
        ) : (
          <motion.div
            key={`${inmueble}-${tipo}`}
            variants={timelineV}
            initial="hidden"
            animate="show"
            className="relative"
          >
            {/* Línea vertical del timeline */}
            <span
              className="absolute bottom-2 left-5 top-2 w-0.5"
              style={{ backgroundColor: 'var(--border)' }}
              aria-hidden
            />
            {groups.map((g) => (
              <div key={g.label}>
                <p
                  className="sticky top-[104px] z-10 -ml-0 mb-1 mt-3 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] lg:top-2"
                  style={{ backgroundColor: 'var(--surface)', color: 'var(--text-faint)' }}
                >
                  {g.label}
                </p>
                {g.items.map((a) => {
                  const meta = TYPE_META[a.type];
                  const role = ROLE_META[a.actorRole];
                  const property = data.getProperty(a.propertyId);
                  const RoleIcon = a.type === 'remota' ? Smartphone : role.icon;
                  return (
                    <motion.div key={a.id} variants={eventV} className="relative flex items-center gap-3 py-2 pl-0">
                      <motion.span
                        initial={reduce ? false : { scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        className="relative z-10 ml-[15px] h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: meta.color, boxShadow: '0 0 0 3px var(--surface)' }}
                        aria-hidden
                      />
                      <PersonAvatar name={a.actorName} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          <span className="font-semibold">{a.actorName}</span>{' '}
                          <span style={{ color: 'var(--text-muted)' }}>{t(meta.actionKey)}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <span className="inline-flex items-center gap-1">
                            <RoleIcon className="h-3 w-3" style={{ color: a.type === 'remota' ? '#3B82F6' : role.color }} />
                            {a.type === 'remota' ? t('ted.remotaCorta') : t(role.labelKey)}
                          </span>
                          {property && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full py-0.5 pl-1 pr-2"
                              style={{ backgroundColor: 'var(--surface-2)' }}
                            >
                              <PropertyAvatar property={property} size={16} className="rounded-md" />
                              <span className="max-w-[110px] truncate text-[11px] font-medium">{property.name}</span>
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs" style={{ color: 'var(--text-faint)' }}>
                        {timeLabel(a.at)}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            ))}
          </motion.div>
        )}

        {visibleCount < allAccesses.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + 5)}
            className="mt-3 w-full rounded-xl py-2 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('ted.cargarMas')}
          </button>
        )}
      </section>

      {/* ============================== Detalle de cerradura */}
      <Dialog open={!!detailLock} onOpenChange={(o) => !o && setDetailLock(null)}>
        <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
          {detailLock && detailProperty && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 font-display text-lg font-semibold">
                  <PropertyAvatar property={detailProperty} size={36} />
                  {detailLock.name}
                </DialogTitle>
                <DialogDescription style={{ color: 'var(--text-muted)' }}>
                  {detailProperty.name} ·{' '}
                  {detailLock.online ? t('ted.vista', { time: fmtRelative(detailLock.lastSeen) }) : t('ted.sinConexion', { time: fmtRelative(detailLock.lastSeen) })}
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center gap-3 rounded-xl p-3" style={{ backgroundColor: 'var(--surface-2)' }}>
                {(() => {
                  const tone = batteryTone(detailLock.battery);
                  const Icon = tone.icon;
                  return (
                    <>
                      <Icon className="h-5 w-5" style={{ color: tone.color }} />
                      <div className="flex-1">
                        <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                          {t('ted.bateria')}
                        </p>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--border)' }}>
                          <span className="block h-full rounded-full" style={{ width: `${detailLock.battery}%`, backgroundColor: tone.color }} />
                        </span>
                      </div>
                      <span className="font-display tnum text-lg font-semibold" style={{ color: tone.color }}>
                        {detailLock.battery} %
                      </span>
                    </>
                  );
                })()}
              </div>

              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
                  {t('ted.historial')}
                </p>
                {detailAccesses.length === 0 ? (
                  <p className="py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                    {t('ted.sinAccesosRecientes')}
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {detailAccesses.map((a) => {
                      const meta = TYPE_META[a.type];
                      return (
                        <div key={a.id} className="flex items-center gap-2.5 border-b py-2 last:border-0" style={{ borderColor: 'var(--border)' }}>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            <span className="font-medium">{a.actorName}</span>{' '}
                            <span style={{ color: 'var(--text-muted)' }}>{t(meta.actionKey)}</span>
                          </span>
                          <span className="shrink-0 text-xs" style={{ color: 'var(--text-faint)' }}>
                            {timeLabel(a.at)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {!data.isDemo && (
                <button
                  type="button"
                  disabled={!detailLock.online || opening}
                  onClick={() => setConfirmOpen(true)}
                  className="brand-gradient flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {opening ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  {opening ? t('ted.abriendo') : detailLock.online ? t('ted.abrirAhora') : t('ted.cerraduraOffline')}
                </button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('ted.confirmTitulo')}
        description={detailLock ? t('ted.confirmDesc', { name: detailLock.name }) : undefined}
        confirmLabel={t('ted.abrirAhora')}
        onConfirm={openNow}
      />

    </div>
  );
}
