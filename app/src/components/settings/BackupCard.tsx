import { useEffect, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Card } from './settings-cards';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { fmtRelative } from '@/lib/format';

interface BackupConfig {
  enabled: boolean;
  retentionDays: number;
  lastBackup: string | null;
}

export default function BackupCard() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<BackupConfig>('/api/config/backup')
      .then(setConfig)
      .catch(() => undefined);
  }, []);

  const saveConfig = async (patch: Partial<BackupConfig>) => {
    setSaving(true);
    try {
      const updated = await api<{ ok: boolean; config: BackupConfig }>('/api/config/backup', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      if (updated.ok) {
        setConfig(updated.config);
        toast.success(t('aj.backupGuardado'));
      }
    } catch {
      toast.error(t('aj.errorGuardar'));
    } finally {
      setSaving(false);
    }
  };

  const runBackup = async () => {
    setRunning(true);
    try {
      const result = await api<{ ok: boolean; path: string }>('/api/backup/run', { method: 'POST' });
      if (result.ok) {
        toast.success(t('aj.backupCreado'));
        setConfig((prev) => prev ? { ...prev, lastBackup: new Date().toISOString() } : prev);
      }
    } catch {
      toast.error(t('aj.backupError'));
    } finally {
      setRunning(false);
    }
  };

  if (!config) return null;

  return (
    <Card title={t('aj.backup')} desc={t('aj.backupDesc')}>
      <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
        {/* Backup automático */}
        <div className="flex min-h-14 items-center justify-between gap-3 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-indigo-500" />
            <div>
              <p className="text-sm font-semibold">{t('aj.backupAuto')}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('aj.backupAutoDesc')}
              </p>
            </div>
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => void saveConfig({ enabled: v })}
            disabled={saving}
            className="data-[state=checked]:bg-[#6366F1]"
          />
        </div>

        {/* Retención */}
        <div className="flex min-h-14 items-center justify-between gap-3 py-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <p className="text-sm font-semibold">{t('aj.retencion')}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('aj.retencionDesc')}
            </p>
          </div>
          <select
            value={config.retentionDays}
            onChange={(e) => void saveConfig({ retentionDays: Number(e.target.value) })}
            disabled={saving}
            className="h-9 rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40 disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
          >
            <option value={3}>3 {t('aj.dias')}</option>
            <option value={7}>7 {t('aj.dias')}</option>
            <option value={14}>14 {t('aj.dias')}</option>
            <option value={30}>30 {t('aj.dias')}</option>
            <option value={60}>60 {t('aj.dias')}</option>
            <option value={90}>90 {t('aj.dias')}</option>
          </select>
        </div>

        {/* Último backup + ejecutar ahora */}
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-semibold">{t('aj.ultimoBackup')}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {config.lastBackup
                ? fmtRelative(new Date(config.lastBackup))
                : t('aj.nunca')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runBackup()}
            disabled={running}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold transition-all',
              running
                ? 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                : 'brand-gradient text-white hover:brightness-110 active:scale-[0.98]'
            )}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', running && 'animate-spin')} />
            {running ? t('aj.ejecutando') : t('aj.ejecutarAhora')}
          </button>
        </div>
      </div>
    </Card>
  );
}
