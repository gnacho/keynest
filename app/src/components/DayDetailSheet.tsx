import { useEffect, useState } from 'react';
import { BedDouble, Sparkles, Wrench } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import StatusBadge from '@/components/StatusBadge';
import PropertyAvatar from '@/components/PropertyAvatar';
import PersonAvatar from '@/components/PersonAvatar';
import { useData } from '@/data/useData';
import { capitalize, fmtDateLong, fmtTime, isSameDay, startOfDay } from '@/lib/format';

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

interface DayDetailSheetProps {
  date: Date | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Sheet (móvil) / Dialog (desktop) compartido para detalle de día (design.md §7.10). */
export default function DayDetailSheet({ date, open, onOpenChange }: DayDetailSheetProps) {
  const desktop = useIsDesktop();
  const { getReservations, getProperties, getCleanings, getMaintenance, getProperty, getPerson } = useData();

  if (!date) return null;
  const day = startOfDay(date).getTime() + 12 * 3600 * 1000;

  const checkIns = getReservations().filter((r) => isSameDay(r.checkIn, date));
  const checkOuts = getReservations().filter((r) => isSameDay(r.checkOut, date));
  const stays = getReservations().filter(
    (r) => r.checkIn.getTime() < day && r.checkOut.getTime() > day,
  );
  const cleanings = getCleanings().filter((c) => isSameDay(c.date, date));
  const maintenance = getMaintenance().filter(
    (t) => t.scheduledDate && isSameDay(t.scheduledDate, date),
  );

  const STATUS_LABEL: Record<string, string> = {
    pendiente: 'Pendiente',
    asignada: 'Asignada',
    'en-curso': 'En curso',
    archivada: 'Archivada',
    nueva: 'Nueva',
    finalizada: 'Finalizada',
  };

  const body = (
    <div className="flex flex-col gap-4">
      {checkIns.length === 0 && checkOuts.length === 0 && stays.length === 0 && cleanings.length === 0 && maintenance.length === 0 && (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Sin actividad este día.
        </p>
      )}

      {checkIns.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
            Entradas
          </p>
          {checkIns.map((r) => {
            const p = getProperty(r.propertyId)!;
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-xl p-2" style={{ backgroundColor: 'var(--surface-2)' }}>
                <PropertyAvatar property={p} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.guest.name}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{p.name}</p>
                </div>
                <StatusBadge label={`Entrada ${fmtTime(r.checkIn)}`} tone="emerald" dot />
              </div>
            );
          })}
        </section>
      )}

      {checkOuts.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
            Salidas
          </p>
          {checkOuts.map((r) => {
            const p = getProperty(r.propertyId)!;
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-xl p-2" style={{ backgroundColor: 'var(--surface-2)' }}>
                <PropertyAvatar property={p} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.guest.name}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{p.name}</p>
                </div>
                <StatusBadge label={`Salida ${fmtTime(r.checkOut)}`} tone="orange" dot />
              </div>
            );
          })}
        </section>
      )}

      {stays.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
            Estancias
          </p>
          {stays.map((r) => {
            const p = getProperty(r.propertyId)!;
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-xl p-2" style={{ backgroundColor: 'var(--surface-2)' }}>
                <BedDouble className="h-4 w-4 shrink-0 text-blue-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.guest.name}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    {p.name} · {r.guestsCount} huéspedes
                  </p>
                </div>
                <StatusBadge label="En curso" tone="blue" dot />
              </div>
            );
          })}
        </section>
      )}

      {cleanings.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
            Limpiezas
          </p>
          {cleanings.map((c) => {
            const p = getProperty(c.propertyId)!;
            const person = c.assigneeIds.length > 0 ? getPerson(c.assigneeIds[0]) : undefined;
            return (
              <div key={c.id} className="flex items-center gap-3 rounded-xl p-2" style={{ backgroundColor: 'var(--surface-2)' }}>
                <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    {person ? person.name : 'Sin asignar'}
                  </p>
                </div>
                {person && <PersonAvatar name={person.name} initials={person.initials} size={24} />}
                <StatusBadge label={STATUS_LABEL[c.status] ?? c.status} />
              </div>
            );
          })}
        </section>
      )}

      {maintenance.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
            Mantenimiento
          </p>
          {maintenance.map((t) => {
            const p = getProperties().find((pp) => pp.id === t.propertyId)!;
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-xl p-2" style={{ backgroundColor: 'var(--surface-2)' }}>
                <Wrench className="h-4 w-4 shrink-0 text-rose-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{t.title}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{p.name}</p>
                </div>
                {t.urgent && <StatusBadge label="Urgente" tone="rose" dot pulse />}
                <StatusBadge label={STATUS_LABEL[t.status] ?? t.status} />
              </div>
            );
          })}
        </section>
      )}
    </div>
  );

  const title = capitalize(fmtDateLong(date));

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay">
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
