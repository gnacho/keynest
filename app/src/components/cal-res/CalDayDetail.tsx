import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, MoonStar, Sparkles, Users } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import StatusBadge from '@/components/StatusBadge';
import PropertyAvatar from '@/components/PropertyAvatar';
import PersonAvatar from '@/components/PersonAvatar';
import MoneyText from '@/components/MoneyText';
import EmptyState from '@/components/EmptyState';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import type { Property, Reservation } from '@/data/types';
import { capitalize, fmtDateLong, fmtDateShort, fmtDateShortYear, fmtTime, isSameDay } from '@/lib/format';
import { agesBreakdown, dayInfoFor, nextReservationAfter, nightsOf } from './calendar-utils';
import type { DayKind } from './calendar-utils';
import { requestIcon } from './request-icon';

function useIsDesktop() {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

const KIND_LABEL_KEY: Record<Exclude<DayKind, 'libre' | 'rotacion'>, string> = {
  entrada: 'cal.entrada',
  salida: 'cal.salida',
  estancia: 'cal.estancia',
};

const CLEANING_LABEL_KEY: Record<string, string> = {
  pendiente: 'estado.pendiente',
  asignada: 'estado.asignada',
  'en-curso': 'estado.enCurso',
  archivada: 'estado.archivada',
};

interface CalDayDetailProps {
  date: Date | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Inmuebles visibles según el filtro actual */
  properties: Property[];
  /** Modo "solo desocupado": los inmuebles libres se listan en el detalle */
  onlyDesocupado?: boolean;
}

/**
 * Detalle de día del calendario (calendario.md §Detalle de día):
 * reserva, huésped, edades, peticiones especiales y limpieza asociada.
 * Sheet slide-up en móvil / Dialog centrado en desktop.
 */
export default function CalDayDetail({ date, open, onOpenChange, properties, onlyDesocupado = false }: CalDayDetailProps) {
  const { t } = useTranslation();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const data = useData();

  if (!date) return null;

  const reservations = data.getReservations();
  const cleanings = data.getCleanings();

  // Reservas del día dentro del ámbito filtrado (con su semántica)
  const dayReservations: { r: Reservation; p: Property; kind: DayKind }[] = [];
  const freeProperties: Property[] = [];
  for (const p of properties) {
    const info = dayInfoFor(reservations, p.id, date);
    const res = info.checkIn ?? info.stay ?? info.checkOut;
    if (info.kind !== 'libre' && res) dayReservations.push({ r: res, p, kind: info.kind });
    if (info.kind === 'libre') freeProperties.push(p);
  }

  const next = nextReservationAfter(reservations, properties, date);
  const nextFor = (p: Property) => nextReservationAfter(reservations, [p], date);

  const statusPills = dayReservations.map(({ r, p, kind }) => (
    <StatusBadge
      key={`${p.id}-${r.id}`}
      label={kind === 'rotacion' ? `${t('cal.salidaEntrada')} · ${p.name}` : `${t(KIND_LABEL_KEY[kind as keyof typeof KIND_LABEL_KEY])} · ${p.name}`}
      tone={kind === 'entrada' ? 'emerald' : kind === 'salida' ? 'orange' : kind === 'rotacion' ? 'orange' : 'blue'}
      dot
    />
  ));

  const body = (
    <div className="flex flex-col gap-4">
      {statusPills.length > 0 && <div className="flex flex-wrap gap-1.5">{statusPills}</div>}

      {/* Modo "solo desocupado": lista de inmuebles libres ese día */}
      {onlyDesocupado && freeProperties.length > 0 && (
        <div className="flex flex-col gap-2">
          {freeProperties.map((p) => {
            const nextP = nextFor(p);
            return (
              <section
                key={p.id}
                className="flex items-center gap-3 rounded-2xl border p-3"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
              >
                <PropertyAvatar property={p} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    {nextP ? t('cal.proximaReserva', { date: fmtDateShort(nextP.checkIn), name: '' }) : t('cal.sinProximas')}
                  </p>
                </div>
                <StatusBadge label={t('cal.libre')} tone="slate" dot />
              </section>
            );
          })}
        </div>
      )}

      {dayReservations.length === 0 && !(onlyDesocupado && freeProperties.length > 0) && (
        <div>
          <EmptyState
            icon={MoonStar}
            title={onlyDesocupado ? t('cal.todoOcupado') : t('cal.diaLibre')}
            text={
              next
                ? t('cal.proximaReserva', { date: fmtDateShort(next.checkIn), name: data.getProperty(next.propertyId)?.name ?? '' })
                : t('cal.sinProximas')
            }
            className="py-6"
          />
        </div>
      )}

      {dayReservations.map(({ r, p }) => {
        const cleaning = cleanings.find((c) => c.reservationId === r.id);
        const isCheckoutDay = isSameDay(r.checkOut, date);
        const ages = agesBreakdown(r.guestAges);
        const ReqIcon = r.specialRequest ? requestIcon(r.specialRequest) : null;
        const assignee = cleaning && cleaning.assigneeIds.length > 0 ? data.getPerson(cleaning.assigneeIds[0]) : undefined;
        return (
          <section
            key={r.id}
            className="flex flex-col gap-3 rounded-2xl border p-3"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            {/* Inmueble */}
            <div className="flex items-center gap-3">
              <PropertyAvatar property={p} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{p.name}</p>
                <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                  {p.address}
                </p>
              </div>
            </div>

            {/* Huésped */}
            <div className="flex items-center gap-3">
              <PersonAvatar name={r.guest.name} initials={r.guest.initials} size={32} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{r.guest.name}</p>
                <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                  {r.guest.country}
                </p>
              </div>
            </div>
            <p
              className="flex items-center gap-1.5 text-xs font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              <Users className="h-3.5 w-3.5" />
              {t('cal.huesped', { count: r.guestsCount })}
              {ages && <span>· {ages}</span>}
            </p>

            {/* Fechas + importe */}
            <div
              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
              style={{ backgroundColor: 'var(--surface-2)' }}
            >
              <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                <p className="font-display tnum text-[13px] font-medium" style={{ color: 'var(--text)' }}>
                  {r.checkIn.getFullYear() !== r.checkOut.getFullYear()
                    ? `${fmtDateShortYear(r.checkIn)} ${fmtTime(r.checkIn)} → ${fmtDateShortYear(r.checkOut)} ${fmtTime(r.checkOut)}`
                    : `${fmtDateShort(r.checkIn)} ${fmtTime(r.checkIn)} → ${fmtDateShort(r.checkOut)} ${fmtTime(r.checkOut)}`}
                </p>
                <p>{t('cal.noches', { count: nightsOf(r) })}</p>
              </div>
              <MoneyText value={r.amount} className="text-base text-emerald-500" />
            </div>

            {/* Peticiones especiales */}
            {r.specialRequest && ReqIcon && (
              <div
                className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold"
                style={{
                  backgroundColor: 'rgb(245 158 11 / 0.12)',
                  borderColor: 'rgb(245 158 11 / 0.3)',
                  color: '#B45309',
                }}
              >
                <ReqIcon className="h-4 w-4 shrink-0" />
                {capitalize(r.specialRequest)}
              </div>
            )}

            {/* Limpieza asociada (día de salida) */}
            {isCheckoutDay && cleaning && (
              <div
                className="flex items-center gap-2 rounded-xl px-3 py-2"
                style={{ backgroundColor: 'var(--vi-chip-bg)' }}
              >
                <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold" style={{ color: 'var(--vi-chip-text)' }}>
                    {t('cal.limpiezaSalida')}
                  </p>
                  <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    {assignee ? assignee.name : t('cal.sinAsignar')}
                  </p>
                </div>
                <StatusBadge label={t(CLEANING_LABEL_KEY[cleaning.status] ?? 'estado.pendiente')} />
                {!assignee && cleaning.status !== 'archivada' && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/limpieza?tarea=${cleaning.id}`);
                    }}
                    className="rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: '#8B5CF6' }}
                  >
                    {t('cal.asignar')}
                  </button>
                )}
              </div>
            )}

            {/* CTA */}
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate(`/reservas?inmueble=${p.slug}&reserva=${r.id}`);
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              {t('cal.verReserva')}
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        );
      })}
    </div>
  );

  const title = capitalize(fmtDateLong(date));

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85dvh] max-w-md overflow-y-auto rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">{title}</DialogTitle>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[82dvh] overflow-y-auto rounded-t-3xl border-[var(--border)] bg-[var(--surface)] pb-[calc(24px+env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="pb-2 text-left">
          <SheetTitle className="font-display text-lg font-semibold">{title}</SheetTitle>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}
