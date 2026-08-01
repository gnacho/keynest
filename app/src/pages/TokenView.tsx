import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LimpiezaToken from '@/pages/LimpiezaToken';
import MantenimientoToken from '@/pages/MantenimientoToken';

/** Dispatcher /t/:token — un token puede ser de persona (limpieza) o de orden de trabajo (proveedor). */
export default function TokenView() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const [type, setType] = useState<'person' | 'workorder' | 'invalid' | null>(null);

  useEffect(() => {
    void fetch(`/api/t/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          setType('invalid');
          return;
        }
        const d = (await res.json()) as { type?: 'person' | 'workorder' };
        setType(d.type === 'workorder' ? 'workorder' : 'person');
      })
      .catch(() => setType('invalid'));
  }, [token]);

  if (type === 'invalid') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-6" style={{ backgroundColor: 'var(--bg)' }}>
        <p className="text-center text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
          {t('wo.enlaceInvalido')}
        </p>
      </div>
    );
  }
  if (type === null) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
        <RefreshCw className="h-5 w-5 animate-spin" style={{ color: 'var(--text-faint)' }} />
      </div>
    );
  }
  return type === 'workorder' ? <MantenimientoToken /> : <LimpiezaToken />;
}
