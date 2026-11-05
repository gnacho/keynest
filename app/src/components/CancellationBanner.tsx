import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, TriangleAlert, X } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateRangeShort, fmtMoney, fmtRelative } from '@/lib/format';
import {
  cancellationGuest,
  dismissCancellation,
  readDismissed,
  visibleCancellations,
  type CancellationNotice,
} from '@/lib/cancellations';

/** Fecha YYYY-MM-DD a Date local (sin desplazar el dia por la zona horaria). */
function fechaLocal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Banner ROJO de reservas canceladas (#340). Se monta en el shell, consulta
 * las cancelaciones recientes al arrancar y se refresca con el evento SSE
 * 'cancellation.changed' (DataProvider lo reemite como evento de window).
 * Cada aviso se descarta por separado y no vuelve a aparecer.
 */
export default function CancellationBanner() {
  const { t } = useTranslation();
  const [items, setItems] = useState<CancellationNotice[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await api<{ cancellations: CancellationNotice[] }>('/api/cancellations/recent');
      setItems(visibleCancellations(res.cancellations ?? [], readDismissed(window.localStorage)));
    } catch {
      /* sin red o sesion expirada: no molestar */
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener('keynest-cancellations-changed', onChange);
    return () => window.removeEventListener('keynest-cancellations-changed', onChange);
  }, [load]);

  const dismiss = (id: number) => {
    dismissCancellation(window.localStorage, id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  if (items.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {items.map((item) => {
        const entrada = fechaLocal(item.checkin);
        const salida = fechaLocal(item.checkout);
        const estancia = entrada && salida ? fmtDateRangeShort(entrada, salida) : `${item.checkin} - ${item.checkout}`;
        return (
          <div
            key={item.id}
            role="status"
            className="flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]"
            style={{ borderColor: 'rgb(244 63 94 / 0.4)', backgroundColor: 'rgb(244 63 94 / 0.1)', color: '#E11D48' }}
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {t('cancelaciones.titulo')}
                {item.propertyName ? ` · ${item.propertyName}` : ''}
              </p>
              <p className="mt-0.5 opacity-90">
                {t('cancelaciones.quien', { quien: cancellationGuest(item) })}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 opacity-90">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {estancia}
                </span>
                {item.amount > 0 && <span>{t('cancelaciones.importe', { importe: fmtMoney(item.amount) })}</span>}
                <span className="opacity-80">{fmtRelative(new Date(item.cancelledAt))}</span>
              </p>
              <p className="mt-1 font-medium">{t('cancelaciones.disponible')}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label={t('cancelaciones.cerrar')}
              title={t('cancelaciones.cerrar')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--surface-2)]"
              style={{ borderColor: 'rgb(244 63 94 / 0.3)' }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
