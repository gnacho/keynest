// Tarjetas de Ajustes (webapp-shell adaptado a Keynest):
// Apariencia (tema con previews pintados con las variables CSS reales,
// densidad), Mi sesión (idioma, notificaciones por tipo, push,
// cambiar contraseña + cerrar sesión), y Acerca de (versión + repo + PWA +
// bloque de sistema tipo NetPulse).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import React from 'react';
import { Bell, Check, Download, FileText, Github, Heart, KeyRound, Languages, LogOut, Mail, Moon, MonitorSmartphone, Pencil, ShieldCheck, Sun, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useTheme } from '@/theme/ThemeProvider';
import type { ThemeMode } from '@/theme/ThemeProvider';
import { api } from '@/lib/api';
import { cachedUser, logout } from '@/lib/auth';
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
  const { mode, setMode, density, setDensity } = useTheme();

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
  const isDemo = Boolean(cachedUser()?.is_demo);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold">{tr('aj.diasAviso')}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {tr('aj.diasAvisoDesc')}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {isDemo ? (
          <span className="font-display tnum w-20 text-center text-sm font-semibold">{days}</span>
        ) : (
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
        )}
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

const TIPOS_NOTIF = [
  'checkin_hoy',
  'checkout_hoy',
  'reserva_nueva',
  'transaccion',
  'tedee_offline',
  'tedee_ok',
  'tedee_bateria',
  'limpieza_pendiente',
] as const;

/* ---------- Tarjeta Mi perfil (canónica webapp-shell): avatar + nombre + email + idioma + notifs + contraseña + logout ----------
   Estructura ProfileCard: línea horizontal SIN flex-wrap; nombre/email editables
   con input + botones ✓/✕; notificaciones como botón Bell que despliega panel
   inline; logout SIEMPRE a la derecha con texto visible y encuadrado en rojo. */
export function SessionCard({ isDemo }: { isDemo: boolean }) {
  const { t: tr } = useTranslation();
  const [showPwd, setShowPwd] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const user = cachedUser();
  const [nameDraft, setNameDraft] = useState(user?.display_name ?? '');
  const [emailDraft, setEmailDraft] = useState(user?.email ?? '');
  const [editingName, setEditingName] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [lang, setLang] = useState<AppLanguage>(() => user?.language ?? cachedLanguagePref());
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const { soporte, estado, activar, desactivar } = usePush();

  // Preferencias por tipo: solo tienen sentido con el push suscrito en este
  // dispositivo (patrón Helios/skill web-push-alerts).
  useEffect(() => {
    if (!estado.suscrito) {
      setPrefs(null);
      return;
    }
    api<{ prefs: Record<string, boolean> }>('/api/push/preferences')
      .then((r) => setPrefs(r.prefs))
      .catch(() => setPrefs(null));
  }, [estado.suscrito]);

  const saveProfile = async (field: 'displayName' | 'email', value: string) => {
    try {
      await api('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(field === 'displayName' ? { displayName: value } : { email: value }),
      });
    } catch { /* toast error */ }
  };

  const changeLang = (v: AppLanguage) => {
    setLang(v);
    applyLanguage(v);
    void (async () => {
      const { saveLanguage } = await import('@/lib/auth');
      await saveLanguage(v).catch(() => undefined);
    })();
  };

  const cambiarPref = (tipo: string, enabled: boolean) => {
    setPrefs((p) => (p ? { ...p, [tipo]: enabled } : p));
    api('/api/push/preferences', { method: 'PUT', body: JSON.stringify({ tipo, enabled }) }).catch(() => {
      setPrefs((p) => (p ? { ...p, [tipo]: !enabled } : p)); // rollback optimista
    });
  };

  const saveName = async () => {
    const value = nameDraft.trim();
    if (value === (user?.display_name ?? '')) { setEditingName(false); return; }
    setBusy(true);
    try {
      await saveProfile('displayName', value);
      setEditingName(false);
    } finally { setBusy(false); }
  };

  const saveEmail = async () => {
    const value = emailDraft.trim();
    if (value === (user?.email ?? '')) { setEditingEmail(false); return; }
    setBusy(true);
    try {
      await saveProfile('email', value);
      setEditingEmail(false);
    } finally { setBusy(false); }
  };

  const cancelName = () => {
    setNameDraft(user?.display_name ?? '');
    setEditingName(false);
  };

  const cancelEmail = () => {
    setEmailDraft(user?.email ?? '');
    setEditingEmail(false);
  };

  const changePassword = async () => {
    setError('');
    if (form.next.length < 6) { setError(tr('aj.passErrCorta')); return; }
    if (form.next !== form.repeat) { setError(tr('aj.passErrCoincide')); return; }
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
    } finally { setBusy(false); }
  };

  const avatarSrc = user?.avatar || null;
  const displayName = user?.display_name || user?.username || '—';

  const actionBtnCls =
    'flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]';
  const actionTextCls = 'hidden sm:inline';

  return (
    <Card title={tr('aj.miPerfil')}>
      {/* Línea horizontal con flex-wrap (envuelve a 2 líneas en móvil) */}
      <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
        {/* Avatar */}
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--accent-soft, #e3f0e9)' }}>
          {avatarSrc ? (
            <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ color: 'var(--accent, #2f7d5f)' }}>
              <User className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Nombre + email + rol */}
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') cancelName(); }}
                disabled={busy}
                className="h-8 w-full min-w-[120px] rounded-lg border bg-[var(--surface)] px-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                style={{ borderColor: 'var(--border)' }}
                placeholder={user?.username}
                autoFocus
              />
              <button type="button" onClick={() => void saveName()} disabled={busy} aria-label={tr('aj.guardar')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:brightness-110 disabled:opacity-50"
                style={{ backgroundColor: '#6366F1' }}>
                <Check className="h-4 w-4" />
              </button>
              <button type="button" onClick={cancelName} disabled={busy} aria-label={tr('aj.cancelar')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : isDemo ? (
            <p className="truncate text-base font-semibold leading-tight">{displayName}</p>
          ) : (
            <button type="button" onClick={() => setEditingName(true)} title={tr('aj.editarNombre')} className="group flex min-w-0 items-center gap-1.5 text-left">
              <span className="truncate text-base font-semibold leading-tight">{displayName}</span>
              <Pencil className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
            </button>
          )}

          {editingEmail ? (
            <div className="mt-1 flex items-center gap-1.5">
              <input
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveEmail(); if (e.key === 'Escape') cancelEmail(); }}
                disabled={busy}
                className="h-7 w-full min-w-[120px] rounded-lg border bg-[var(--surface)] px-2 text-xs outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                placeholder={tr('aj.emailPlaceholder')}
                autoFocus
              />
              <button type="button" onClick={() => void saveEmail()} disabled={busy} aria-label={tr('aj.guardar')}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:brightness-110 disabled:opacity-50"
                style={{ backgroundColor: '#6366F1' }}>
                <Check className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={cancelEmail} disabled={busy} aria-label={tr('aj.cancelar')}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : isDemo ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              {user?.email ? (
                <>
                  <Mail className="h-3.5 w-3.5 shrink-0" style={{ color: '#F59E0B' }} aria-hidden="true" />
                  <span className="truncate">{user.email}</span>
                </>
              ) : (
                <span>{tr('aj.emailVacio')}</span>
              )}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setEditingEmail(true)}
              title={user?.email || tr('aj.emailVacio')}
              className="mt-0.5 flex items-center gap-1 text-xs transition-colors hover:underline"
              style={{ color: 'var(--text-muted)' }}
            >
              {user?.email ? (
                <>
                  <Mail className="h-3.5 w-3.5 shrink-0" style={{ color: '#F59E0B' }} aria-hidden="true" />
                  <span className="truncate">{user.email}</span>
                </>
              ) : (
                <span>{tr('aj.emailVacio')}</span>
              )}
            </button>
          )}
          <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-faint)' }}>
            @{user?.username}
            {user?.role ? ` · ${user.role === 'admin' ? tr('aj.rolAdmin') : tr('aj.rolUsuario')}` : ''}
          </p>
        </div>

        {/* Idioma */}
        {!isDemo && (
          <Select value={lang} onValueChange={(v) => changeLang(v as AppLanguage)}>
            <SelectTrigger aria-label={tr('aj.idioma')} className="h-9 w-9 justify-center rounded-lg border text-xs sm:w-[120px] sm:justify-between" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              <Languages className="h-4 w-4 sm:hidden" aria-hidden="true" />
              <span className="hidden sm:inline"><SelectValue /></span>
            </SelectTrigger>
            <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
              <SelectItem value="auto">🌐 Auto</SelectItem>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.flag} {l.nativeName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Contraseña */}
        {!isDemo && (
          <button
            type="button"
            aria-expanded={showPwd}
            onClick={() => setShowPwd((v) => !v)}
            className={actionBtnCls}
            title={tr('aj.cambiarPassword')}
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            <span className={actionTextCls}>{tr('aj.cambiarPassword')}</span>
          </button>
        )}

        {/* Notificaciones */}
        {!isDemo && (
          <button
            type="button"
            aria-expanded={showNotif}
            onClick={() => setShowNotif((v) => !v)}
            className={actionBtnCls}
            title={tr('aj.notificaciones')}
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            <span className={actionTextCls}>{tr('aj.notificaciones')}</span>
          </button>
        )}

        {/* Logout — SIEMPRE a la derecha, rojo; texto solo en ≥sm */}
        <button
          type="button"
          onClick={() => { void logout(); }}
          className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors hover:bg-red-50 dark:hover:bg-red-950/20 sm:px-3"
          style={{ borderColor: 'var(--danger-border, #fca5a5)', color: 'var(--danger, #ef4444)', backgroundColor: 'rgb(var(--danger-rgb) / 0.10)' }}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className={actionTextCls}>{isDemo ? tr('aj.salirDemo') : tr('aj.cerrarSesion')}</span>
        </button>
      </div>

      {/* Form contraseña desplegable */}
      <AnimatePresence>
        {showPwd && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="mt-4 overflow-hidden border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
              <input type="password" placeholder={tr('aj.passActual')} value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} className="h-9 rounded-lg border px-3 text-sm outline-none" style={{ borderColor: 'var(--border)' }} autoComplete="current-password" />
              <input type="password" placeholder={tr('aj.passNueva')} value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} className="h-9 rounded-lg border px-3 text-sm outline-none" style={{ borderColor: 'var(--border)' }} autoComplete="new-password" />
              <input type="password" placeholder={tr('aj.passRepetir')} value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} className="h-9 rounded-lg border px-3 text-sm outline-none" style={{ borderColor: 'var(--border)' }} autoComplete="new-password" />
              {error && <p className="text-xs font-medium text-red-500">{error}</p>}
              <button type="button" disabled={busy} onClick={() => { void changePassword(); }} className="h-9 rounded-lg bg-violet-500 px-4 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">{busy ? tr('aj.guardando') : tr('aj.guardar')}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Panel notificaciones desplegable: push + toggles por tipo */}
      <AnimatePresence>
        {showNotif && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="mt-4 overflow-hidden border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex flex-col gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
              {/* Push */}
              {soporte === 'requiere-https' ? (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{tr('aj.pushRequiereHttps')}</p>
              ) : soporte === 'ok' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{tr('aj.notificaciones')}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{estado.suscrito ? tr('aj.notifActivadas') : tr('aj.pushInactivas')}</p>
                    </div>
                    {estado.suscrito ? (
                      <button type="button" onClick={() => { void desactivar(); }} disabled={estado.cargando} className="h-8 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>{tr('aj.notifDesactivar')}</button>
                    ) : (
                      <button type="button" onClick={() => { void activar(); }} disabled={estado.cargando} className="h-8 rounded-lg bg-violet-500 px-3 text-xs font-semibold text-white disabled:opacity-50">{tr('aj.notifActivar')}</button>
                    )}
                  </div>
                  {estado.error && (
                    <p className="text-xs" style={{ color: '#F43F5E' }}>{estado.error}</p>
                  )}
                </div>
              ) : null}

              {/* Toggles por tipo: solo con el push suscrito en este dispositivo */}
              {estado.suscrito && prefs && (
                <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>{tr('aj.notifTipos')}</p>
                  {TIPOS_NOTIF.map((tipo) => (
                    <div key={tipo} className="flex items-center justify-between gap-3">
                      <span className="text-sm" style={{ color: 'var(--text)' }}>{tr(`aj.notifTipo.${tipo}`)}</span>
                      <Switch
                        checked={prefs[tipo] !== false}
                        onCheckedChange={(checked) => cambiarPref(tipo, checked)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
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

function SystemInfoBlock({ info: propInfo }: { info?: SystemInfoData | null }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SystemInfoData | null>(propInfo ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (propInfo) { setInfo(propInfo); return; }
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
  }, [propInfo]);

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

/* ---------- Tarjeta Acerca de: logo + enlaces + versión·licencia·runtime (canon webapp-shell) ----------
   Fila 1: logo + nombre + descripción a la izquierda, tiles de enlaces BAJOS a la derecha.
   Fila 2: versión · licencia · runtime en UNA línea sin recuadros, alineada con la descripción.
   El instalador PWA y Comprobar actualizaciones NO viven aquí (InstallCard propia / AdminBar). */
export function AboutCard() {
  const { t: tr } = useTranslation();
  const [info, setInfo] = useState<SystemInfoData | null>(null);

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
        if (!disposed) setInfo(null);
      }
    })();
    return () => { disposed = true; };
  }, []);

  const server = info && !info.demo ? info : null;
  const runtimeLine = `Node ${server?.nodeVersion || '—'} · React v${React.version} · ${tr('aj.aboutUptime')} ${server ? fmtUptime(server.uptimeS) : '—'}`;
  const tiles = [
    { key: 'code', icon: Github, label: tr('aj.aboutCode'), href: REPO_URL },
    { key: 'changelog', icon: FileText, label: tr('aj.aboutCambios'), href: `${REPO_URL}/commits/main` },
    { key: 'kofi', icon: Heart, label: tr('aj.aboutKofi') },
    { key: 'privacy', icon: ShieldCheck, label: tr('aj.aboutPrivacidad') },
  ];
  const linkCls = 'flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition-colors duration-150 hover:border-[#6366F1]/50 hover:text-[#6366F1]';
  const plainCls = 'flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium';

  return (
    <Card title={tr('aj.acercaDe')}>
      <div className="space-y-5">
        {/* Fila 1: logo + nombre + descripción a la izquierda, enlaces a la derecha */}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex items-start gap-3.5">
            <img src="/logo.svg" alt="Keynest" className="h-10 w-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-semibold tracking-[-0.01em]">Keynest</p>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                {tr('aj.acercaDeDesc')}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {tiles.map((item) =>
              item.href ? (
                <a key={item.key} href={item.href} target="_blank" rel="noreferrer" className={linkCls}>
                  <item.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  <span className="leading-snug" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
                </a>
              ) : (
                <div key={item.key} className={plainCls} style={{ color: 'var(--text-muted)' }}>
                  <item.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  <span className="leading-snug">{item.label}</span>
                </div>
              ),
            )}
          </div>
        </div>
        {/* Fila 2: versión · licencia · runtime en UNA línea sin recuadros,
            alineada con la descripción (tras el logo) en escritorio */}
        <p className="font-mono text-[11px] md:pl-[54px]" style={{ color: 'var(--text-faint)' }}>
          v{APP_VERSION} · AGPL-3.0 · {runtimeLine}
        </p>

        {/* Bloque Sistema fusionado dentro de Acerca de (patrón EasyZFS) */}
        <SystemInfoBlock info={info} />
      </div>
    </Card>
  );
}

/* ---------- Tarjeta Instalar app (PWA): tarjeta propia, NO vive en Acerca de ---------- */
export function InstallCard() {
  const { t: tr } = useTranslation();
  const { state, install } = useInstallPrompt();

  // 'hidden' = navegador sin soporte → NO renderizar nada (regla del usuario)
  if (state === 'hidden') return null;

  return (
    <Card title={tr('aj.instalarApp')}>
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
    </Card>
  );
}
