// Renovación de la sesión Airbnb (solo admin): genera un código de
// emparejamiento de un solo uso; el capturador local lo usa para subir la
// sesión nueva, y este diálogo lo detecta y confirma el final.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Paso = 'pidiendo' | 'codigo' | 'listo' | 'error';

const POLL_MS = 4000;

export default function AirbnbRenewDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [paso, setPaso] = useState<Paso>('pidiendo');
  const [code, setCode] = useState('');
  const [expira, setExpira] = useState(0);
  const [resto, setResto] = useState(0);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setPaso('pidiendo');
    const gen = async () => {
      try {
        const r = await api<{ code: string; expira: number }>('/api/airbnb/pairing', { method: 'POST' });
        if (stale) return;
        setCode(r.code);
        setExpira(r.expira);
        setResto(Math.max(0, Math.round((r.expira - Date.now()) / 1000)));
        setPaso('codigo');
      } catch {
        if (stale) return;
        setPaso('error');
        toast.error(t('airbnb.renovarError'));
      }
    };
    void gen();
    return () => {
      stale = true;
    };
  }, [open, t]);

  useEffect(() => {
    if (!open || paso !== 'codigo') return;
    const countdown = window.setInterval(() => {
      setResto(Math.max(0, Math.round((expira - Date.now()) / 1000)));
    }, 1000);
    const poll = window.setInterval(async () => {
      try {
        const st = await api<{ sesion: { viva?: boolean } }>('/api/airbnb/status');
        if (st.sesion?.viva === false) return;
        window.clearInterval(countdown);
        window.clearInterval(poll);
        setPaso('listo');
        toast.success(t('airbnb.renovarHecho'));
        window.setTimeout(() => onOpenChange(false), 1100);
      } catch {
        /* sin red: se sigue probando */
      }
    }, POLL_MS);
    return () => {
      window.clearInterval(countdown);
      window.clearInterval(poll);
    };
  }, [open, paso, expira, t, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold">{t('airbnb.renovarTitulo')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {paso === 'codigo' && (
            <>
              <p className="text-sm text-muted-foreground">{t('airbnb.renovarIntro')}</p>
              <div className="rounded-xl border-[var(--border)] bg-[var(--surface-2)] p-4 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('airbnb.renovarCodigo')}
                </div>
                <div className="mt-1 font-mono text-3xl font-bold tracking-[0.35em]">{code}</div>
                <div className="mt-2 text-xs text-muted-foreground">{t('airbnb.renovarExpira', { s: resto })}</div>
              </div>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t('airbnb.renovarEsperando')}</span>
              </p>
            </>
          )}
          {paso === 'pidiendo' && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('airbnb.renovarEsperando')}</span>
            </p>
          )}
          {paso === 'listo' && (
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
              <Check className="h-4 w-4" />
              <span>{t('airbnb.renovarHecho')}</span>
            </p>
          )}
          {paso === 'error' && <p className="text-sm font-semibold text-rose-500">{t('airbnb.renovarError')}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('airbnb.renovarCerrar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
