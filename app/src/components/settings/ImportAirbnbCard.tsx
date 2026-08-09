// Importar CSV "Historial de transacciones" de Airbnb (solo admin):
// selecciona el CSV → vista previa (dry-run) → mapea listings sin asignar →
// aplicar (idempotente: re-importar solo actualiza nombre+importe).
import { useRef, useState } from 'react';
import { Check, FileUp, RefreshCw, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useData } from '@/data/useData';
import { fmtMoney } from '@/lib/format';

interface Preview {
  matched: number;
  inserted: number;
  updated: number;
  unmapped: string[];
  totalMatched: number;
  totalInserted: number;
  dupes: number;
  skipped: number;
  total: number;
}

export default function ImportAirbnbCard() {
  const { t: tr } = useTranslation();
  const data = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Preview | null>(null);

  const properties = data.getProperties();

  const runDry = async (text: string, mapping: Record<string, string>) => {
    setBusy(true);
    try {
      const p = await api<Preview>('/api/import/airbnb', {
        method: 'POST',
        body: JSON.stringify({ csv: text, dry: true, map: mapping }),
      });
      setPreview(p);
      // autoselecciona el inmueble si un listing sin mapear contiene el nombre de uno
      const auto: Record<string, string> = { ...mapping };
      for (const u of p.unmapped) {
        if (!auto[u]) auto[u] = '';
      }
      setMap(auto);
    } catch {
      toast.error(tr('aj.importarError'));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
    setDone(null);
    await runDry(text, {});
  };

  const remap = async (listing: string, propertyId: string) => {
    const next = { ...map, [listing]: propertyId };
    setMap(next);
    if (propertyId) await runDry(csvText, next);
  };

  const apply = async () => {
    if (busy || !preview || preview.unmapped.length > 0) return;
    setBusy(true);
    try {
      const p = await api<Preview>('/api/import/airbnb', {
        method: 'POST',
        body: JSON.stringify({ csv: csvText, dry: false, map }),
      });
      setDone(p);
      setPreview(null);
      toast.success(tr('aj.importarOk', { updated: p.updated, inserted: p.inserted }));
      await data.refresh();
    } catch {
      toast.error(tr('aj.importarError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4 md:p-6">
      {/* Cabecera: título + botón Seleccionar CSV en la misma línea (botón a la
          derecha); la descripción va debajo a ancho completo. */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate font-display text-lg font-semibold tracking-[-0.01em]">
            {tr('aj.importarCsv')}
          </h2>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="flex h-10 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)] disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" strokeWidth={1.75} />}
            {tr('aj.seleccionarCsv')}
          </button>
        </div>
      </div>
      {fileName && !done && (
        <p className="mt-2 truncate text-xs" style={{ color: 'var(--text-faint)' }}>
          {fileName}
        </p>
      )}

      {preview && (
        <div className="flex flex-col gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
          <p className="text-sm font-semibold">{tr('aj.vistaPrevia')}</p>
          <ul className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            <li>{tr('aj.impTotal', { count: preview.total })}</li>
            <li>{tr('aj.impCasan', { count: preview.matched })}</li>
            <li>{tr('aj.impNuevas', { count: preview.inserted, amount: fmtMoney(preview.totalInserted) })}</li>
            {(preview.dupes > 0 || preview.skipped > 0) && (
              <li>{tr('aj.impIgnoradas', { dupes: preview.dupes, skipped: preview.skipped })}</li>
            )}
          </ul>
          {preview.unmapped.length > 0 && (
            <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.impMapear')}
              </p>
              {preview.unmapped.map((listing) => (
                <div key={listing} className="grid gap-2 sm:grid-cols-[1fr_180px] sm:items-center">
                  <span className="truncate text-[13px]" title={listing} style={{ color: 'var(--text)' }}>
                    {listing}
                  </span>
                  <Select value={map[listing] || ''} onValueChange={(v) => void remap(listing, v)}>
                    <SelectTrigger aria-label={tr('aj.impInmueble')} className="h-9 rounded-xl border-[var(--border)] bg-[var(--surface)] text-xs shadow-none">
                      <SelectValue placeholder={tr('aj.impElegir')} />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                      {properties.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={busy || preview.unmapped.length > 0}
            onClick={() => void apply()}
            className="brand-gradient flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            <Upload className="h-4 w-4" strokeWidth={1.75} />
            {tr('aj.aplicarImportacion')}
          </button>
        </div>
      )}

      {done && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
          <Check className="h-3.5 w-3.5" />
          {tr('aj.importarOk', { updated: done.updated, inserted: done.inserted })}
        </p>
      )}
    </div>
  );
}
