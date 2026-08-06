import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronLeft, ClipboardList, MapPin, Phone, RefreshCw, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import CleaningPhotos from '@/components/tareas/CleaningPhotos';
import PersonAvatar from '@/components/PersonAvatar';
import StatusBadge from '@/components/StatusBadge';
import { fmtDateShort } from '@/lib/format';
import { cn } from '@/lib/utils';

/* Vista pública por token de UNA orden de trabajo (proveedor):
   qué hacer (título/notas/inmueble), checks, fotos de la reparación y finalizar. */

interface WoCheck {
  id: string;
  label: string;
  done: boolean;
}

interface WoTask {
  id: string;
  title: string;
  category: string;
  urgent: number;
  notes: string;
  status: 'nueva' | 'asignada' | 'finalizada';
  scheduled_date: string | null;
  cost: number | null;
  checks: WoCheck[];
  photos: string[];
}

interface WoPayload {
  type: 'workorder';
  task: WoTask;
  property: { id: string; name: string; address: string; photo: string; instructions: string } | null;
  assignee: { id: string; name: string; phone: string; specialty: string; hourly_rate: number } | null;
}

export default function MantenimientoToken() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [payload, setPayload] = useState<WoPayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState('');

  useEffect(() => {
    void fetch(`/api/t/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const d = (await res.json()) as WoPayload;
        setPayload(d);
        if (d.task.cost != null) setCost(String(d.task.cost));
      })
      .catch(() => setNotFound(true));
  }, [token]);

  const action = async (body: Record<string, unknown>): Promise<WoTask | undefined> => {
    if (busy) return undefined;
    setBusy(true);
    try {
      const res = await fetch(`/api/t/${token}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return undefined;
      const d = (await res.json()) as { task: WoTask };
      setPayload((p) => (p ? { ...p, task: d.task } : p));
      return d.task;
    } finally {
      setBusy(false);
    }
  };

  const uploadPhoto = async (file: File): Promise<string[] | undefined> => {
    const fd = new FormData();
    fd.append('photo', file);
    const res = await fetch(`/api/t/${token}/task/photo`, { method: 'POST', body: fd });
    if (!res.ok) return undefined;
    const d = (await res.json()) as { task: WoTask };
    setPayload((p) => (p ? { ...p, task: d.task } : p));
    return d.task.photos;
  };

  if (notFound) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-6" style={{ backgroundColor: 'var(--bg)' }}>
        <p className="text-center text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
          {t('wo.enlaceInvalido')}
        </p>
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
        <RefreshCw className="h-5 w-5 animate-spin" style={{ color: 'var(--text-faint)' }} />
      </div>
    );
  }

  const { task, property, assignee } = payload;
  const done = task.status === 'finalizada';
  const doneChecks = task.checks.filter((k) => k.done).length;

  return (
    <div className="min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)' }}>
      <header
        className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-md"
        style={{ backgroundColor: 'color-mix(in srgb, var(--surface) 88%, transparent)', borderColor: 'var(--border)' }}
      >
        <img src="/logo.svg" alt="Keynest" className="h-7 w-7" />
        <p className="flex-1 truncate font-display text-[15px] font-semibold">{t('wo.ordenTrabajo')}</p>
        <StatusBadge label={t(`mant.${task.status}`)} dot pulse={!done} />
      </header>

      <motion.main
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-16 pt-4"
      >
        {/* Inmueble */}
        {property && (
          <section className="card overflow-hidden">
            {property.photo && (
              <div className="relative h-28">
                <img src={property.photo} alt={property.name} className="h-full w-full object-cover" />
              </div>
            )}
            <div className="flex flex-col gap-1 p-4">
              <p className="font-display text-lg font-semibold">{property.name}</p>
              <p className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                <MapPin className="h-3.5 w-3.5" />
                {property.address}
              </p>
              {property.instructions && (
                <p className="mt-2 rounded-xl px-3 py-2 text-[13px]" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                  {property.instructions}
                </p>
              )}
            </div>
          </section>
        )}

        {/* La orden */}
        <section className="card flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <h1 className="font-display text-xl font-semibold leading-6">{task.title}</h1>
            {Boolean(task.urgent) && <StatusBadge label={t('mant.urgente')} tone="rose" dot />}
          </div>
          {task.scheduled_date && (
            <p className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('wo.fechaPrevista', { date: fmtDateShort(new Date(`${task.scheduled_date}T12:00:00`)) })}
            </p>
          )}
          {task.notes && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
                {t('wo.trabajoARealizar')}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-6">{task.notes}</p>
            </div>
          )}
          {assignee && (
            <div className="flex items-center gap-2.5 rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
              <PersonAvatar
                name={assignee.name}
                initials={assignee.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                size={32}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{assignee.name}</p>
                <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                  {assignee.specialty}
                </p>
              </div>
              {assignee.phone && (
                <a
                  href={`tel:${assignee.phone.replace(/\s/g, '')}`}
                  className="flex items-center gap-1 text-xs font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Phone className="h-3.5 w-3.5" />
                  {assignee.phone}
                </a>
              )}
            </div>
          )}
        </section>

        {/* Checks */}
        {task.checks.length > 0 && (
          <section className="card flex flex-col gap-2 p-4">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
              <ClipboardList className="h-3.5 w-3.5" />
              {t('wo.checks', { done: doneChecks, total: task.checks.length })}
            </p>
            <div className="flex flex-col">
              {task.checks.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  disabled={busy || done}
                  onClick={() => void action({ action: 'toggle-check', checkId: k.id })}
                  className="flex items-center gap-2 rounded-lg px-1.5 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-2)] disabled:opacity-60"
                >
                  <span
                    className={cn(
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-all',
                      k.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'text-transparent',
                    )}
                    style={k.done ? undefined : { borderColor: 'var(--border)' }}
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span className={cn(k.done && 'line-through opacity-60')}>{k.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Fotos de la reparación */}
        <section className="card flex flex-col gap-2 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
            {t('wo.fotos')}
          </p>
          <CleaningPhotos photos={task.photos} onUpload={uploadPhoto} />
        </section>

        {/* Finalizar */}
        <section className="card flex flex-col gap-3 p-4">
          {done ? (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-500">
                <Check className="h-4 w-4" />
                {t('wo.finalizadaOk', { cost: task.cost != null ? `${task.cost} €` : '—' })}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action({ action: 'reopen' })}
                className="flex h-9 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {t('wo.reabrir')}
              </button>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {t('wo.costeFinal')}
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0,00"
                  className="h-10 rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                  style={{ borderColor: 'var(--border)' }}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const n = Number(String(cost).replace(',', '.'));
                  void action({ action: 'complete', cost: Number.isFinite(n) && cost !== '' ? n : null });
                }}
                className="brand-gradient flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                <Wrench className="h-4 w-4" />
                {busy ? t('wo.guardando') : t('wo.marcarFinalizada')}
              </button>
            </>
          )}
        </section>
      </motion.main>
    </div>
  );
}
