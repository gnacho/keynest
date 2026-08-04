// Tarjetas de Ajustes (webapp-shell adaptado a Keynest):
// Apariencia (tema con previews pintados con las variables CSS reales,
// densidad, reduce-motion), Mi sesión (idioma, nivel de alertas, push,
// cambiar contraseña + cerrar sesión), y Acerca de (versión + repo + PWA +
// bloque de sistema tipo NetPulse).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import React from 'react';
import { Check, Download, Github, KeyRound, LogOut, Moon, MonitorSmartphone, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTheme } from '@/theme/ThemeProvider';
import type { ThemeMode } from '@/theme/ThemeProvider';
import { api } from '@/lib/api';
import { cachedUser, logout, saveNotificationLevel } from '@/lib/auth';
import { applyLanguage, cachedLanguagePref } from '@/i18n';
import type { AppLanguage } from '@/i18n';
import { useData } from '@/data/useData';
import { usePush } from '@/hooks/usePush';
import { cn } from '@/lib/utils';
import pkg from '../../../package.json';

export const APP_VERSION: string = pkg.version;
export const REPO_URL = 'https://github.com/gnacho/keynest';

/** Idiomas soportados: bandera + nombre NATIVO con acentos. */
export const LANGUAGES: { code: Exclude<AppLanguage, 'auto'>; flag: string; nativeName: string }[] = [
  { code: 'es', flag: '🇪🇸', nativeName: 'Español' },
  { code: 'en', flag: '🇬🇧', nativeName: 'English' },
];

/* ---------- Tarjeta base ----------
   animate (no whileInView): en páginas largas las tarjetas bajo el fold
   deben existir visualmente aunque el usuario aún no haya hecho scroll. */
export function Card({ title, desc, children, className }: { title: string; desc?: string; children: ReactNode; className?: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
      className={cn('card p-4 md:p-6', className)}
    >
      <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">{title}</h2>
      {desc && (
        <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {desc}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </motion.section>
  );
}

/* ---------- Preview de tema con las variables CSS reales ----------
   Scopea la clase light/dark en el propio contenedor → los tokens del preview
   SON los de la app; prohibido hardcodear hex (rompe lint:theme). */
function ThemePreview({ variant }: { variant: 'dark' | 'light' | 'system' }) {
  const half = (
    <div className="flex h-full w-1/2 flex-col gap-1 bg-canvas p-1.5">
      <div className="h-1.5 w-3/4 rounded-sm bg-elevated" />
      <div className="flex flex-1 gap-1">
        <div className="w-1/4 rounded-sm bg-surface" />
        <div className="flex flex-1 flex-col gap-1">
          <div className="h-2 rounded-sm bg-brand/60" />
          <div className="flex-1 rounded-sm bg-surface" />
        </div>
      </div>
    </div>
  );
  return (
    <div className="h-16 w-full overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)' }}>
      {variant === 'system' ? (
        <div className="flex h-full">
          <div className="dark w-1/2">{half}</div>
          <div className="light w-1/2">{half}</div>
        </div>
      ) : (
        <div className={cn('h-full', variant)}>{half}</div>
      )}
    </div>
  );
}

const THEME_OPTIONS: { value: ThemeMode; labelKey: string; icon: typeof Moon }[] = [
  { value: 'light', labelKey: 'aj.claro', icon: Sun },
  { value: 'dark', labelKey: 'aj.oscuro', icon: Moon },
  { value: 'system', labelKey: 'aj.sistema', icon: MonitorSmartphone },
];

/* ---------- Tarjeta Apariencia ---------- */
export function AppearanceCard() {
  const { t: tr } = useTranslation();
  const { mode, setMode, density, setDensity, reduceMotion, setReduceMotion } = useTheme();

  return (
    <Card title={tr('aj.apariencia')} desc={tr('aj.aparienciaDesc')}>
      {/* Tema: 3 opciones con mini-preview (variables CSS reales) */}
      <div>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {tr('aj.tema')}
        </span>
        <div role="radiogroup" aria-label={tr('aj.tema')} className="mt-1.5 grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={mode === opt.value}
              onClick={() => setMode(opt.value)}
              className={cn('relative flex flex-col gap-2 rounded-xl border p-2 text-left transition-colors duration-150')}
              style={{
                borderColor: mode === opt.value ? '#6366F1' : 'var(--border)',
                backgroundColor: mode === opt.value ? 'rgb(99 102 241 / 0.08)' : 'transparent',
              }}
            >
              <ThemePreview variant={opt.value} />
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <opt.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {tr(opt.labelKey)}
              </span>
              {mode === opt.value && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: '#6366F1' }}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </motion.span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Densidad */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{tr('aj.densidad')}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {tr('aj.densidadDesc')}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label={tr('aj.densidad')}
          className="flex items-center gap-1 rounded-xl border p-1"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}
        >
          {(
            [
              { id: 'comfortable', labelKey: 'aj.densidadComoda' },
              { id: 'compact', labelKey: 'aj.densidadCompacta' },
            ] as const
          ).map((d) => {
            const active = density === d.id;
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDensity(d.id)}
                className={cn(
                  'flex h-8 items-center rounded-lg px-3 text-xs font-semibold transition-colors duration-150',
                  active ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                )}
                style={active ? { backgroundImage: 'linear-gradient(135deg,#6366F1,#8B5CF6)' } : undefined}
              >
                {tr(d.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Reducir animaciones */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{tr('aj.reducirAnimaciones')}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {tr('aj.reducirAnimacionesDesc')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={reduceMotion}
          onClick={() => setReduceMotion(!reduceMotion)}
          className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150')}
          style={{ backgroundColor: reduceMotion ? '#6366F1' : 'var(--surface-2)' }}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150',
              reduceMotion ? 'translate-x-[22px]' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {/* Días de aviso en el panel (preferencia por usuario) */}
      <LookaheadRow />
    </Card>
  );
}

/* ---------- Fila "Días de aviso en el panel" (por usuario) ---------- */
function LookaheadRow() {
  const { t: tr } = useTranslation();
  const { getSettings, saveSettings } = useData();
  const [days, setDays] = useState(() => getSettings().lookaheadDays);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold">{tr('aj.diasAviso')}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {tr('aj.diasAvisoDesc')}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={30}
          value={days}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 1 && v <= 30) {
              setDays(v);
              void saveSettings({ lookaheadDays: v });
            }
          }}
          aria-label={tr('aj.diasAviso')}
          className="h-9 w-20 rounded-xl border bg-[var(--surface)] px-3 text-center text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
          style={{ borderColor: 'var(--border)' }}
        />
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {tr('aj.dias')}
        </span>
      </div>
    </div>
  );
}

/* ---------- Instalar PWA: solo si el navegador lo soporta ---------- */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true,
  );
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // 'hidden' = navegador sin soporte → NO renderizar nada (regla del usuario)
  const state: 'installed' | 'installable' | 'ios' | 'hidden' = installed
    ? 'installed'
    : deferred
      ? 'installable'
      : isIos
        ? 'ios'
        : 'hidden';

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') setDeferred(null);
  };

  return { state, install };
}

type NotifLevel = 'all' | 'important' | 'none';

const NOTIF_LEVELS: { value: NotifLevel; labelKey: string }[] = [
  { value: 'all', labelKey: 'aj.notifLevelAll' },
  { value: 'important', labelKey: 'aj.notifLevelImportant' },
  { value: 'none', labelKey: 'aj.notifLevelNone' },
];

/* ---------- Tarjeta Mi sesión: idioma + notificaciones + password + logout ---------- */
export function SessionCard({ isDemo }: { isDemo: boolean }) {
  const { t: tr } = useTranslation();
  const [showPwd, setShowPwd] = useState(false);
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<AppLanguage>(() => cachedUser()?.language ?? cachedLanguagePref());
  const [notifLevel, setNotifLevel] = useState<NotifLevel>(() => cachedUser()?.notification_level ?? 'all');
  const { soporte, estado, activar, desactivar } = usePush();

  const changeLang = (v: AppLanguage) => {
    setLang(v);
    applyLanguage(v);
    void (async () => {
      const { saveLanguage } = await import('@/lib/auth');
      await saveLanguage(v).catch(() => undefined);
    })();
  };

  const changeNotifLevel = (v: NotifLevel) => {
    setNotifLevel(v);
    void saveNotificationLevel(v).catch(() => setNotifLevel(notifLevel));
  };

  const inputCls =
    'h-10 w-full rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40';

  const changePassword = async () => {
    setError('');
    if (form.next.length < 6) {
      setError(tr('aj.passErrCorta'));
      return;
    }
    if (form.next !== form.repeat) {
      setError(tr('aj.passErrCoincide'));
      return;
    }
    setBusy(true);
    try {
      await api('/api/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ current: form.current, next: form.next }),
      });
      setShowPwd(false);
      setForm({ current: '', next: '', repeat: '' });
      toast.success(tr('aj.passCambiada'));
    } catch (err) {
      setError(err instanceof Error && err.message.includes('actual') ? tr('aj.passErrActual') : tr('aj.passErrGeneral'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={tr('aj.miSesion')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{tr('aj.idioma')}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {tr('aj.idiomaDesc')}
          </p>
        </div>
        <Select value={lang} onValueChange={(v) => changeLang(v as AppLanguage)}>
          <SelectTrigger
            aria-label={tr('aj.idioma')}
            className="h-10 w-[190px] rounded-xl border-[var(--border)] bg-[var(--surface)] shadow-none"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
            <SelectItem value="auto">🌐 {tr('aj.idiomaAuto')}</SelectItem>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.flag} {l.nativeName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{tr('aj.notifLevel')}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {tr('aj.notifLevelDesc')}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label={tr('aj.notifLevel')}
          className="flex items-center gap-1 rounded-xl border p-1"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}
        >
          {NOTIF_LEVELS.map((opt) => {
            const active = notifLevel === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => changeNotifLevel(opt.value)}
                className={cn(
                  'flex h-8 items-center rounded-lg px-3 text-xs font-semibold transition-colors duration-150',
                  active ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                )}
                style={active ? { backgroundImage: 'linear-gradient(135deg,#6366F1,#8B5CF6)' } : undefined}
              >
                {tr(opt.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {soporte === 'requiere-https' ? (
        <p className="rounded-xl border px-3.5 py-2.5 text-[13px] leading-snug" style={{ borderColor: 'rgb(245 158 11 / 0.3)', backgroundColor: 'rgb(245 158 11 / 0.08)', color: '#D97706' }}>
          {tr('aj.notifRequiereHttps')}
        </p>
      ) : soporte === 'ok' && !isDemo ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {estado.suscrito ? (
            <button
              type="button"
              onClick={() => void desactivar()}
              disabled={estado.cargando}
              className="flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)] disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              {tr('aj.notifDesactivar')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void activar()}
              disabled={estado.cargando}
              className="flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150 disabled:opacity-50"
              style={{
                borderColor: 'rgb(99 102 241 / 0.4)',
                backgroundColor: 'rgb(99 102 241 / 0.1)',
                color: '#6366F1',
              }}
            >
              {tr('aj.notifActivar')}
            </button>
          )}
          {estado.suscrito && (
            <span className="flex items-center gap-1.5 text-[13px]" style={{ color: '#059669' }}>
              <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
              {tr('aj.notifActivadas')}
            </span>
          )}
          {estado.permiso === 'denied' && (
            <p className="rounded-xl border px-3.5 py-2.5 text-[13px]" style={{ borderColor: 'rgb(244 63 94 / 0.3)', backgroundColor: 'rgb(244 63 94 / 0.08)', color: '#F43F5E' }}>
              {tr('aj.notifPermisoDenegado')}
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2.5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        {!isDemo && (
          <button
            type="button"
            aria-expanded={showPwd}
            onClick={() => {
              setShowPwd((v) => !v);
              setError('');
            }}
            className="flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <KeyRound className="h-4 w-4" strokeWidth={1.75} style={{ color: 'var(--text-muted)' }} />
            {tr('aj.cambiarPassword')}
          </button>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          className="flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150"
          style={{
            borderColor: 'rgb(244 63 94 / 0.3)',
            backgroundColor: 'rgb(244 63 94 / 0.08)',
            color: '#F43F5E',
          }}
        >
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
          {isDemo ? tr('aj.salirDemo') : tr('aj.cerrarSesion')}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showPwd && !isDemo && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-3 overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.passActual')}
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={form.current}
                onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))}
                className={inputCls}
                style={{ borderColor: 'var(--border)' }}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.passNueva')}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.next}
                  onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))}
                  className={inputCls}
                  style={{ borderColor: 'var(--border)' }}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.passRepetir')}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.repeat}
                  onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value }))}
                  className={inputCls}
                  style={{ borderColor: 'var(--border)' }}
                />
              </label>
            </div>
            {error && (
              <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || !form.current || !form.next || !form.repeat}
                className="brand-gradient flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                {tr('aj.guardar')}
              </button>
              <button
                type="button"
                onClick={() => setShowPwd(false)}
                className="flex h-10 items-center rounded-xl border px-4 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                {tr('aj.cancelar')}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </Card>
  );
}

function fmtUptime(s: number): string {
  if (!s || s <= 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(s)}s`;
}

interface SystemInfoData {
  version: string;
  nodeVersion: string;
  os: string;
  arch: string;
  distro: string;
  kernel: string;
  cpuModel: string;
  cpuCores: number;
  memTotalMb: number;
  uptimeS: number;
  hostname: string;
  demo: boolean;
}

function SystemInfoBlock() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SystemInfoData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const res = await fetch('/api/system/info');
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as SystemInfoData;
        if (!disposed) setInfo(json);
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => { disposed = true; };
  }, []);

  const server = info && !info.demo ? info : null;
  const rows: { label: string; value: string }[] = [
    { label: t('aj.sysApp'), value: `v${server?.version || APP_VERSION}` },
    ...(server ? [{ label: t('aj.sysNode'), value: server.nodeVersion }] : []),
    { label: t('aj.sysReact'), value: React.version },
    ...(server
      ? [
          { label: t('aj.sysOs'), value: `${server.distro || server.os} ${server.arch}`.trim() || '—' },
          { label: t('aj.sysKernel'), value: server.kernel || '—' },
          { label: t('aj.sysCpu'), value: server.cpuModel ? `${server.cpuModel} (${server.cpuCores})` : server.cpuCores > 0 ? `${server.cpuCores}` : '—' },
          { label: t('aj.sysRam'), value: server.memTotalMb > 0 ? `${(server.memTotalMb / 1024).toFixed(1)} GiB` : '—' },
          { label: t('aj.sysUptime'), value: fmtUptime(server.uptimeS) },
          { label: t('aj.sysHostname'), value: server.hostname || '—' },
        ]
      : []),
  ];

  return (
    <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--text-muted)' }}>
        {t('aj.sistema')}
      </p>
      {!info && !failed ? (
        <div className="grid animate-pulse grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <span className="h-3 w-14 rounded" style={{ backgroundColor: 'var(--surface-2)' }} />
              <span className="h-3 w-24 rounded" style={{ backgroundColor: 'var(--surface-2)' }} />
            </div>
          ))}
        </div>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.label}</dt>
              <dd className="truncate font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/* ---------- Tarjeta Acerca de: versión + repo + PWA + sistema ---------- */
export function AboutCard() {
  const { t: tr } = useTranslation();
  const { state, install } = useInstallPrompt();

  return (
    <Card title={tr('aj.acercaDe')}>
      <div className="flex items-center gap-3">
        <img src="/logo.svg" alt="Keynest" className="h-10 w-10" />
        <div>
          <p className="font-display text-lg font-semibold tracking-[-0.01em]">Keynest</p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            v{APP_VERSION} · AGPL-3.0
          </p>
        </div>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {tr('aj.acercaDeDesc')}
      </p>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 w-fit items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
      >
        <Github className="h-4 w-4" strokeWidth={1.75} />
        {tr('aj.codigoFuente')}
      </a>

      {state === 'installed' && (
        <p
          className="inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"
          style={{ borderColor: 'rgb(16 185 129 / 0.3)', backgroundColor: 'rgb(16 185 129 / 0.1)', color: '#10B981' }}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2} /> {tr('aj.appInstalada')}
        </p>
      )}
      {state === 'installable' && (
        <button
          type="button"
          onClick={() => void install()}
          className="brand-gradient flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.99]"
        >
          <Download className="h-5 w-5" strokeWidth={1.75} /> {tr('aj.instalarApp')}
        </button>
      )}
      {state === 'ios' && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {tr('aj.instalarIos')}
        </p>
      )}

      <SystemInfoBlock />
    </Card>
  );
}
