import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarDays, Sparkles, TrendingUp } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import type { Reservation } from '@/data/types';
import { capitalize, fmtDateLong, startOfDay } from '@/lib/format';
import { nightsOf } from './calendar-utils';
import { requestIcon } from './request-icon';

const CLEANING_LABEL_KEY: Record<string, string> = {
  pendiente: 'estado.pendiente',
  asignada: 'estado.asignada',
  'en-curso': 'estado.enCurso',
  archivada: 'estado.archivada',
};

function SectionTitle({ children }: { children: string }) {
  return (
    <p
      className="text-[11px] font-semibold uppercase tracking-[0.08em]"
      style={{ color: 'var(--text-faint)' }}
    >
      {children}
    </p>
  );
}

/**
 * Panel interior de la fila expandida (reservas.md §Fila expandida):
 * Detalles · Peticiones especiales · Operativa.
 */
export default function ReservationDetail({ reservation: r }: { reservation: Reservation }) {
  const { t } = useTranslation();
  const data = useData();
  const [creating, setCreating] = useState(false);
  const [amountStr, setAmountStr] = useState(() => (r.amount > 0 ? String(r.amount).replace('.', ',') : ''));
  const [notesStr, setNotesStr] = useState(() => r.notes ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setAmountStr(r.amount > 0 ? String(r.amount).replace('.', ',') : '');
    setNotesStr(r.notes ?? '');
  }, [r.id, r.amount, r.notes]);

  const dirty =
    (Number(amountStr.replace(',', '.')) || 0) !== r.amount || notesStr !== (r.notes ?? '');

  const save = async () => {
    setSaving(true);
    await data.updateReservation(r.id, {
      amount: Math.max(0, Number(amountStr.replace(',', '.')) || 0),
      notes: notesStr,
    });
    setSaving(false);
    toast.success(t('res.reservaActualizada'));
  };
  const p = data.getProperty(r.propertyId);
  const cleaning = data.getCleanings().find((c) => c.reservationId === r.id);
  const assignee = cleaning && cleaning.assigneeIds.length > 0 ? data.getPerson(cleaning.assigneeIds[0]) : undefined;
  const ReqIcon = r.specialRequest ? requestIcon(r.specialRequest) : null;

  return (
    <div
      className="grid gap-4 rounded-xl p-4 lg:grid-cols-3"
      style={{ backgroundColor: 'var(--surface-2)' }}
    >
      {/* Detalles */}
      <div className="flex flex-col gap-1.5">
        <SectionTitle>{t('res.detalles')}</SectionTitle>
        <p className="text-[13px]">
          <span className="font-display tnum font-medium">{nightsOf(r)}</span> {t('cal.noches', { count: nightsOf(r) })} ·{' '}
          {t('cal.huesped', { count: r.guestsCount })}
        </p>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {t('res.edades', { ages: r.guestAges.length ? r.guestAges.join(', ') : '—' })}
        </p>
        {r.bookedDate && (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {t('res.reservadaEl', { date: fmtDateLong(new Date(`${r.bookedDate}T12:00:00`)) })}
          </p>
        )}
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {t('res.canal')}
        </p>
        {r.notes && (
          <p className="whitespace-pre-line text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {r.notes}
          </p>
        )}
      </div>

      {/* Peticiones especiales */}
      <div className="flex flex-col gap-1.5">
        <SectionTitle>{t('res.peticionesEspeciales')}</SectionTitle>
        {r.specialRequest && ReqIcon ? (
          <div
            className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold"
            style={{
              backgroundColor: 'rgb(245 158 11 / 0.12)',
              borderColor: 'rgb(245 158 11 / 0.3)',
              color: '#B45309',
            }}
          >
            {/* eslint-disable-next-line react-hooks/static-components -- lookup de iconos Lucide, no crea componentes */}
            <ReqIcon className="h-4 w-4 shrink-0" />
            {capitalize(r.specialRequest)}
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {t('res.sinPeticiones')}
          </p>
        )}
      </div>

      {/* Importe manual + notas */}
      <div className="flex flex-col gap-2">
        <SectionTitle>{t('res.importeManual')}</SectionTitle>
        <input
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          aria-label={t('res.importeManual')}
          className="tnum h-9 w-full rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
          style={{ borderColor: 'var(--border)' }}
        />
        <SectionTitle>{t('res.notasReserva')}</SectionTitle>
        <textarea
          value={notesStr}
          onChange={(e) => setNotesStr(e.target.value)}
          rows={3}
          placeholder={t('res.notasReservaPlaceholder')}
          className="w-full resize-none rounded-xl border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
          style={{ borderColor: 'var(--border)' }}
        />
        {dirty && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="brand-gradient flex h-9 items-center justify-center rounded-xl text-xs font-semibold text-white transition-all duration-150 hover:brightness-110 disabled:opacity-50"
          >
            {t('res.guardarReserva')}
          </button>
        )}
      </div>

      {/* Operativa */}
      <div className="flex flex-col gap-2">
        <SectionTitle>{t('res.operativa')}</SectionTitle>
        {cleaning ? (
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {t('res.limpiezaSalida')}
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}
                · {assignee ? assignee.name : t('res.sinAsignar')}
              </span>
            </span>
            <StatusBadge label={t(CLEANING_LABEL_KEY[cleaning.status] ?? 'estado.pendiente')} />
            <Link
              to={`/limpieza?tarea=${cleaning.id}`}
              className="shrink-0 text-xs font-semibold text-violet-500 hover:underline"
            >
              {t('res.verLimpieza')}
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {t('res.sinLimpieza')}
            </p>
            {r.checkOut.getTime() >= startOfDay(new Date()).getTime() && (
              <button
                type="button"
                disabled={creating}
                onClick={async () => {
                  setCreating(true);
                  const res = await data.createCleaning(r.propertyId, r.checkOut, r.id);
                  setCreating(false);
                  if (res === 'occupied') toast.error(t('res.limpiezaOcupada'));
                  else if (res) toast.success(t('res.limpiezaCreada'));
                }}
                className="shrink-0 rounded-xl bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 hover:brightness-110 disabled:opacity-50"
              >
                {creating ? t('res.creando') : t('res.crearLimpieza')}
              </button>
            )}
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-2">
          <Link
            to={`/calendario?inmueble=${p?.slug ?? ''}`}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
            style={{ backgroundColor: 'var(--bl-chip-bg)', color: 'var(--bl-chip-text)' }}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {t('res.verEnCalendario')}
          </Link>
          <Link
            to={`/rentabilidad?inmueble=${p?.slug ?? ''}`}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
            style={{ backgroundColor: 'rgb(99 102 241 / 0.12)', color: '#6366F1' }}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            {t('res.rentabilidad')}
          </Link>
        </div>
      </div>
    </div>
  );
}
