import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { Plus, ShoppingBasket, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import MoneyText from '@/components/MoneyText';
import PersonAvatar from '@/components/PersonAvatar';
import HoursStepper from '@/components/tareas/HoursStepper';
import { useTranslation } from 'react-i18next';
import type { CleaningSupply, CleaningWorkEntry, Person } from '@/data/types';
import { fmtMoney, fmtNumber } from '@/lib/format';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

interface ConfirmCleaningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Personas asignadas (hasta 2): un stepper de horas reales POR PERSONA */
  people: Person[];
  propertyName: string;
  /** Previsión de horas por persona (valor inicial de los steppers) */
  estimatedHours?: number;
  /** Valores iniciales (edición de una limpieza ya confirmada). */
  initialWorkLog?: CleaningWorkEntry[];
  initialSupplies?: CleaningSupply[];
  /** Texto del botón (por defecto "Confirmar y archivar"). */
  confirmLabel?: string;
  onConfirm: (workLog: CleaningWorkEntry[], supplies: CleaningSupply[], total: number) => void;
}

/**
 * Confirmación final de limpieza (2ª fase):
 * - Horas reales POR PERSONA (stepper 0,5 h por cada asignada).
 * - Gastos de productos de limpieza: líneas concepto + importe añadibles.
 * - Coste total en vivo (count-up): Σ(horas × €/h de cada persona) + productos.
 */
export default function ConfirmCleaningDialog({
  open,
  onOpenChange,
  people,
  propertyName,
  estimatedHours = 2,
  initialWorkLog,
  initialSupplies,
  confirmLabel,
  onConfirm,
}: ConfirmCleaningDialogProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [hoursBy, setHoursBy] = useState<Record<string, number>>({});
  const [supplies, setSupplies] = useState<CleaningSupply[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');

  /* Al abrir: horas iniciales = previsión; productos vacíos */
  useEffect(() => {
    if (open) {
      if (initialWorkLog?.length) {
        setHoursBy(Object.fromEntries(initialWorkLog.map((w) => [w.personId, w.hours])));
      } else {
        setHoursBy(Object.fromEntries(people.map((p) => [p.id, estimatedHours])));
      }
      setSupplies(initialSupplies ?? []);
      setNewLabel('');
      setNewAmount('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const suppliesTotal = supplies.reduce((acc, s) => acc + s.amount, 0);
  const laborPerPerson = people.map((p) => ({
    person: p,
    hours: hoursBy[p.id] ?? estimatedHours,
    amount: (hoursBy[p.id] ?? estimatedHours) * p.hourlyRate,
  }));
  // Edición: también personas del workLog que ya no estén asignadas
  for (const w of initialWorkLog ?? []) {
    if (!laborPerPerson.some((l) => l.person.id === w.personId)) {
      const ghost = { id: w.personId, name: '—', initials: '?', role: 'limpieza' as const, specialty: '', hourlyRate: 0, phone: '' };
      laborPerPerson.push({ person: ghost, hours: hoursBy[w.personId] ?? w.hours, amount: 0 });
    }
  }
  const total = laborPerPerson.reduce((acc, l) => acc + l.amount, 0) + suppliesTotal;

  /* Count-up corto (300ms) del total en cada cambio */
  const [animatedTotal, setAnimatedTotal] = useState(total);
  const prev = useRef(total);
  useEffect(() => {
    if (reduce) {
      prev.current = total;
      return; // prefers-reduced-motion: valor final directo
    }
    const c = animate(prev.current, total, {
      duration: 0.3,
      ease: EASE_OUT_QUART,
      onUpdate: setAnimatedTotal,
    });
    prev.current = total;
    return () => c.stop();
  }, [total, reduce]);
  const displayTotal = reduce ? total : animatedTotal;

  const parsedAmount = Number(newAmount.replace(',', '.'));
  const canAddSupply = newLabel.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0;

  const addSupply = () => {
    if (!canAddSupply) return;
    setSupplies((prev) => [...prev, { label: newLabel.trim(), amount: Math.round(parsedAmount * 100) / 100 }]);
    setNewLabel('');
    setNewAmount('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] overflow-y-auto overflow-x-hidden rounded-2xl border-[var(--border)] bg-[var(--surface)] p-4 shadow-overlay sm:!max-w-[min(768px,94vw)] sm:p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold">{t('tareas.confirmarTitulo')}</DialogTitle>
          <DialogDescription style={{ color: 'var(--text-muted)' }}>
            {t('tareas.confirmarDesc', { name: propertyName })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Dos columnas en sm+: horas reales | gastos de productos (#211) */}
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
          {/* Horas reales por persona */}
          <div>
            <p
              className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: 'var(--text-faint)' }}
            >
              {t('tareas.horasReales')}
            </p>
            <div className="flex flex-col gap-2">
              {laborPerPerson.map(({ person, hours }) => (
                <div
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <PersonAvatar name={person.name} initials={person.initials} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">{person.name}</span>
                      <span className="block text-[11px]" style={{ color: 'var(--text-faint)' }}>
                        {fmtMoney(person.hourlyRate, true)}/h
                      </span>
                    </span>
                  </span>
                  <HoursStepper
                    compact
                    value={hours}
                    onChange={(h) => setHoursBy((prev) => ({ ...prev, [person.id]: h }))}
                    ariaLabel={t('tareas.horasReales') + ' · ' + person.name}
                  />
                </div>
              ))}
              {people.length === 0 && (
                <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  {t('tareas.sinAsignadas')}
                </p>
              )}
            </div>
          </div>

          {/* Gastos de productos de limpieza */}
          <div>
            <p
              className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: 'var(--text-faint)' }}
            >
              {t('tareas.gastosProductos')}
            </p>
            {supplies.length > 0 && (
              <div className="mb-2 flex flex-col gap-1">
                {supplies.map((s, i) => (
                  <div
                    key={`${s.label}-${i}`}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-[13px]"
                    style={{ backgroundColor: 'var(--surface-2)' }}
                  >
                    <ShoppingBasket className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    <span className="tnum font-display font-medium">{fmtMoney(s.amount, true)}</span>
                    <button
                      type="button"
                      onClick={() => setSupplies((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={t('tareas.quitarA', { name: s.label })}
                      className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface)]"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t('tareas.conceptoPlaceholder')}
                className="h-10 min-w-0 flex-1 rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                style={{ borderColor: 'var(--border)' }}
              />
              <span
                className="flex h-10 w-24 shrink-0 items-center gap-1 rounded-xl border px-2"
                style={{ borderColor: 'var(--border)' }}
              >
                <input
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="3,50"
                  aria-label={t('tareas.importeProducto')}
                  className="tnum h-full w-full bg-transparent text-sm font-medium outline-none"
                />
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  €
                </span>
              </span>
              <button
                type="button"
                onClick={addSupply}
                disabled={!canAddSupply}
                aria-label={t('tareas.anadirProducto')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-400 text-rose-500 transition-colors hover:bg-[var(--ro-chip-bg)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {t('tareas.gastoExtras')}
            </p>
          </div>
          </div>

          {/* Desglose en vivo */}
          <div className="flex flex-col gap-2 rounded-2xl p-3.5" style={{ backgroundColor: 'var(--surface-2)' }}>
            {laborPerPerson.map(({ person, hours, amount }) => (
              <div key={person.id} className="flex items-center gap-2.5 text-[13px]">
                <PersonAvatar name={person.name} initials={person.initials} size={24} />
                <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-muted)' }}>
                  {person.name} · {fmtNumber(hours, 1)} h × {fmtMoney(person.hourlyRate, true)}/h
                </span>
                <span className="tnum font-display font-medium">{fmtMoney(amount, true)}</span>
              </div>
            ))}
            {supplies.map((s, i) => (
              <div key={`${s.label}-${i}`} className="flex items-center gap-2.5 text-[13px]">
                <span className="w-6" />
                <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-muted)' }}>
                  {s.label}
                </span>
                <span className="tnum font-display font-medium">{fmtMoney(s.amount, true)}</span>
              </div>
            ))}
            <div
              className="mt-1 flex items-center justify-between border-t pt-2.5"
              style={{ borderColor: 'var(--border)' }}
            >
              <span className="text-[13px] font-semibold">{t('tareas.total')}</span>
              <MoneyText value={displayTotal} className="text-[28px] font-semibold" />
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const workLog: CleaningWorkEntry[] = laborPerPerson.map(({ person, hours }) => ({
                personId: person.id,
                hours,
              }));
              onConfirm(workLog, supplies, total);
              onOpenChange(false);
            }}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-violet-500 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
          >
            {confirmLabel ?? t('tareas.confirmarArchivar', { total: fmtMoney(total, true) })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
