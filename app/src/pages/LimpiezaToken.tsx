import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Check, ClipboardList, Link2Off, Lock, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import EmptyState from '@/components/EmptyState';
import PersonAvatar from '@/components/PersonAvatar';
import CleaningPhotos from '@/components/tareas/CleaningPhotos';
import PropertyAvatar from '@/components/PropertyAvatar';
import ConfirmCleaningDialog from '@/components/tareas/ConfirmCleaningDialog';
import type { Cleaning, CleaningSupply, CleaningWorkEntry, Property } from '@/data/types';
import { fmtDateShort, fmtTime, isSameDay, startOfDay } from '@/lib/format';
import { chipStyle } from '@/lib/semantic';
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

interface ApiPerson {
  id: string;
  name: string;
  phone: string;
  role: 'limpieza' | 'mantenimiento';
  specialty: string;
  hourly_rate: number;
}
interface ApiPropertyLite {
  id: string;
  name: string;
  address: string;
  photo: string;
  instructions: string;
  checklist: string[];
}
interface ApiCleaningRow {
  id: string;
  property_id: string;
  reservation_id: string | null;
  date: string;
  status: Cleaning['status'];
  assignee_ids: string;
  estimated_hours: number;
  checks: string;
  photos: string;
}

interface TokenData {
  person: ApiPerson;
  cleanings: Cleaning[];
  properties: Record<string, ApiPropertyLite>;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function mapCleaning(row: ApiCleaningRow): Cleaning {
  const [y, m, d] = row.date.split('-').map(Number);
  return {
    id: row.id,
    propertyId: row.property_id,
    reservationId: row.reservation_id ?? undefined,
    date: new Date(y, m - 1, d, 11, 30),
    status: row.status,
    assigneeIds: parseJson<string[]>(row.assignee_ids, []),
    estimatedHours: row.estimated_hours,
    checks: parseJson(row.checks, []),
    photos: parseJson<string[]>(row.photos, []),
  };
}

/**
 * Vista del personal de limpieza con acceso por enlace token (/t/:token).
 * API pública: GET /api/t/:token + POST acciones. Sin login ni provider.
 */
export default function LimpiezaToken() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TokenData | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/t/${token}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const properties: Record<string, ApiPropertyLite> = {};
        for (const p of d.properties ?? []) properties[p.id] = p;
        setData({
          person: d.person,
          cleanings: (d.cleanings ?? []).map(mapCleaning),
          properties,
        });
      })
      .catch(() => setNotFound(true));
  }, [token]);

  const personLike = useMemo(
    () =>
      data
        ? {
            id: data.person.id,
            name: data.person.name,
            initials: data.person.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase(),
            role: 'limpieza' as const,
            specialty: data.person.specialty,
            hourlyRate: data.person.hourly_rate,
            phone: data.person.phone,
          }
        : undefined,
    [data],
  );

  const act = async (cleaningId: string, body: Record<string, unknown>): Promise<Cleaning | null> => {
    const res = await fetch(`/api/t/${token}/cleanings/${cleaningId}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { cleaning: ApiCleaningRow };
    const mapped = mapCleaning(d.cleaning);
    setData((prev) =>
      prev
        ? { ...prev, cleanings: prev.cleanings.map((c) => (c.id === cleaningId ? mapped : c)) }
        : prev,
    );
    return mapped;
  };

  /* -------------------------------------------------- Cargando / token inválido */
  if (notFound) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center" style={{ backgroundColor: 'var(--bg)' }}>
        <img src="/logo.svg" alt="Keynest" className="h-12 w-12" />
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--sl-chip-bg)', color: 'var(--sl-chip-text)' }}
        >
          <Link2Off className="h-8 w-8" strokeWidth={1.8} />
        </span>
        <h1 className="font-display text-xl font-semibold tracking-[-0.01em]">{t('tok.enlaceInvalido')}</h1>
        <p className="max-w-xs text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('tok.enlaceInvalidoTxt')}
        </p>
      </div>
    );
  }

  if (!data || !personLike) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#6366F1]/30 border-t-[#6366F1]" />
      </div>
    );
  }

  const firstName = data.person.name.split(' ')[0];
  const tasks = data.cleanings;

  return (
    <div className="min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)' }}>
      <header
        className="sticky top-0 z-40 flex h-14 items-center justify-between border-b px-4 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--surface) 85%, transparent)',
          borderColor: 'var(--border)',
        }}
      >
        <span className="flex items-center gap-2">
          <img src="/logo.svg" alt="Keynest" className="h-7 w-7" />
          <span className="font-display text-[17px] font-bold tracking-[-0.02em]">Keynest</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-right">
            <span className="block text-[13px] font-semibold leading-tight">{data.person.name}</span>
            <span className="block text-[11px] leading-tight text-violet-500">{t('tok.equipoLimpieza')}</span>
          </span>
          <PersonAvatar name={personLike.name} initials={personLike.initials} size={32} />
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-24 pt-5">
        <motion.div variants={containerV} initial="hidden" animate="show" className="flex flex-col gap-4">
          <motion.div variants={itemV}>
            <h1 className="font-display text-[22px] font-semibold tracking-[-0.02em]">{t('tok.hola', { name: firstName })}</h1>
            <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {tasks.length === 0 ? t('tok.sinLimpiezas') : t('tok.tienes', { count: tasks.length })}
            </p>
          </motion.div>

          {tasks.length === 0 ? (
            <motion.div variants={itemV}>
              <EmptyState
                icon={Sparkles}
                title={t('tok.sinPendientes')}
                text={t('tok.sinPendientesTxt')}
              />
            </motion.div>
          ) : (
            tasks.map((c) => (
              <TokenCleaningCard
                key={c.id}
                cleaning={c}
                propertyLite={data.properties[c.propertyId]}
                person={personLike}
                act={act}
                token={token ?? ''}
              />
            ))
          )}

          <motion.p variants={itemV} className="text-center text-[11px]" style={{ color: 'var(--text-faint)' }}>
            {t('tok.pie')}
          </motion.p>
        </motion.div>
      </main>
    </div>
  );
}

interface PersonLite {
  id: string;
  name: string;
  initials: string;
  role: 'limpieza';
  specialty: string;
  hourlyRate: number;
  phone: string;
}

/* ------------------------------------------------ Tarjeta de limpieza (token) */
function TokenCleaningCard({
  cleaning: c,
  propertyLite,
  person,
  act,
  token,
}: {
  cleaning: Cleaning;
  propertyLite?: ApiPropertyLite;
  person: PersonLite;
  act: (cleaningId: string, body: Record<string, unknown>) => Promise<Cleaning | null>;
  token: string;
}) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<string[]>(() => [...c.photos]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const property: Property = propertyLite
    ? {
        id: propertyLite.id,
        slug: '',
        name: propertyLite.name,
        address: propertyLite.address,
        bedrooms: 0,
        bathrooms: 0,
        area: 0,
        photo: propertyLite.photo,
        checklist: propertyLite.checklist,
        instructions: propertyLite.instructions,
      }
    : {
        id: c.propertyId,
        slug: '',
        name: '',
        address: '',
        bedrooms: 0,
        bathrooms: 0,
        area: 0,
        photo: '',
        checklist: [],
        instructions: '',
      };

  const done = c.checks.filter((k) => k.done).length;
  const total = c.checks.length;
  const isToday = isSameDay(c.date, new Date());
  // La limpieza NO se puede iniciar antes de su fecha prevista (día del check-out)
  const isFuture = startOfDay(c.date).getTime() > startOfDay(new Date()).getTime();

  const toggleCheck = (checkId: string) => {
    void act(c.id, { action: 'toggle-check', checkId });
  };

  return (
    <motion.article variants={itemV} className="card border-l-[3px] border-l-violet-500 p-4">
      {/* Cabecera */}
      <div className="flex items-center gap-3">
        <PropertyAvatar property={property} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{property.name}</p>
          <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            {property.address}
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={chipStyle(isToday ? 'orange' : 'slate')}
        >
          {isToday ? t('tok.salidaHoy', { time: fmtTime(c.date) }) : t('tok.salidaEl', { time: fmtTime(c.date), date: fmtDateShort(c.date) })}
        </span>
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={chipStyle('violet')}
        >
          {t('tok.prevision', { hours: c.estimatedHours ?? 2 })}
        </span>
      </div>

      {/* 1) Instrucciones del inmueble — texto largo, distinto del checklist */}
      {property.instructions && (
        <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
            <ClipboardList className="h-3.5 w-3.5 text-violet-500" />
            {t('tok.instrucciones', { name: property.name })}
          </p>
          <p className="whitespace-pre-line text-[13px] leading-[1.55]" style={{ color: 'var(--text)' }}>
            {property.instructions}
          </p>
        </div>
      )}

      {/* 2) Checklist del inmueble */}
      <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
            {t('tok.checklist', { name: property.name })}
          </p>
          <span className="tnum text-xs font-semibold text-violet-500">
            {done}/{total}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          {c.checks.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => toggleCheck(k.id)}
              className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-[var(--surface)]"
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-150',
                  k.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'text-transparent',
                )}
                style={k.done ? undefined : { borderColor: 'var(--border)' }}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
              <span className={cn(k.done && 'line-through opacity-60')}>{k.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3) Fotos reales (galería/cámara) + retención */}
      <div className="mt-3">
        <CleaningPhotos
          photos={photos}
          onUpload={async (file) => {
            const fd = new FormData();
            fd.append('photo', file);
            const res = await fetch(`/api/t/${token}/cleanings/${c.id}/photo`, {
              method: 'POST',
              credentials: 'same-origin',
              body: fd,
            });
            if (!res.ok) return undefined;
            const d = (await res.json()) as { cleaning: ApiCleaningRow };
            const next = parseJson<string[]>(d.cleaning.photos, []);
            setPhotos(next);
            return next;
          }}
        />
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {t('tok.fotosRetencion')}
        </p>
      </div>

      {/* 4) Acciones: confirmar directo (sin paso intermedio "iniciar") */}
      <div className="mt-3 flex flex-col items-end gap-1.5">
        {(c.status === 'asignada' || c.status === 'en-curso') && !isFuture && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="flex h-10 items-center rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
          >
            {t('tok.confirmar')}
          </button>
        )}
        {(c.status === 'asignada' || c.status === 'en-curso') && isFuture && (
          <>
            <button
              type="button"
              disabled
              className="flex h-10 cursor-not-allowed items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
            >
              <Lock className="h-3.5 w-3.5" />
              {t('tok.confirmar')}
            </button>
            <p className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {t('tok.disponible', { date: fmtDateShort(c.date) })}
            </p>
          </>
        )}
      </div>

      <ConfirmCleaningDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        people={[person]}
        propertyName={property.name}
        estimatedHours={c.estimatedHours ?? 2}
        onConfirm={(workLog: CleaningWorkEntry[], supplies: CleaningSupply[]) => {
          void act(c.id, { action: 'complete', workLog, supplies });
        }}
      />
    </motion.article>
  );
}
