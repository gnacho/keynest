import { useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Lock,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Sunrise,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import UpdateRibbon from '@/components/UpdateRibbon';
import AirbnbSessionRibbon from '@/components/AirbnbSessionRibbon';
import PullToRefresh from '@/components/PullToRefresh';
import NotificationsPopover from '@/components/NotificationsPopover';
import { useUpdateAvailable } from '@/hooks/useUpdateAvailable';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTheme } from '@/theme/ThemeProvider';
import type { ThemeMode } from '@/theme/ThemeProvider';
import { useData } from '@/data/useData';
import { cachedUser, logout } from '@/lib/auth';
import { APP_VERSION } from '@/components/settings/settings-cards';
import PersonAvatar from '@/components/PersonAvatar';
import { cn } from '@/lib/utils';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

/* Items de dominio; Ajustes NO va en el nav principal del sidebar: va abajo,
   en el pie del sidebar. El ThemeToggle vive en la topbar (issue #151).
   En móvil entra en la bottom-nav directa. */
/* NAV_ITEMS es la fuente única (webapp-shell). En DESKTOP (sidebar + raíl) se
   muestran TODOS los de dominio; en MÓVIL la bottom-nav muestra solo los 4
   esenciales (Resumen/Limpieza/Rentabilidad/Ajustes) — Calendario/Reservas/
   Mantenimiento quedan ocultos en móvil pero siguen accesibles por URL directa
   y enlaces del dashboard (y visibles en desktop). */
const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'resumen', icon: LayoutDashboard },
  { to: '/calendario', labelKey: 'calendario', icon: CalendarDays },
  { to: '/reservas', labelKey: 'reservas', icon: BookOpen },
  { to: '/limpieza', labelKey: 'limpieza', icon: Sparkles },
  { to: '/mantenimiento', labelKey: 'mantenimiento', icon: Wrench },
  { to: '/rentabilidad', labelKey: 'rentabilidad', icon: TrendingUp },
  { to: '/inmuebles', labelKey: 'inmuebles', icon: Building2 },
  { to: '/tedee', labelKey: 'tedee', icon: Lock },
];

/* Desktop: todos los de dominio */
const DESKTOP_NAV: NavItem[] = NAV_ITEMS;

/* Móvil (bottom-nav): solo los esenciales + Ajustes */
const HIDDEN_ROUTES = ['/calendario', '/mantenimiento', '/tedee'];
const VISIBLE_NAV: NavItem[] = NAV_ITEMS.filter((i) => !HIDDEN_ROUTES.includes(i.to));

const SETTINGS_ITEM: NavItem = { to: '/ajustes', labelKey: 'ajustes', icon: Settings };

/* Móvil (bottom-nav): esenciales (Resumen/Reservas/Limpieza/Rentabilidad) sin
   Ajustes — Ajustes se accede desde el avatar de usuario del header. Inmuebles
   tampoco va: se gestiona desde el Sheet del inmueble en Resumen. */
const BOTTOM_ITEMS: NavItem[] = VISIBLE_NAV.filter((i) => i.to !== '/inmuebles');

const TITLE_KEYS: Record<string, string> = {
  '/': 'resumen',
  '/calendario': 'calendario',
  '/reservas': 'reservas',
  '/limpieza': 'limpieza',
  '/mantenimiento': 'mantenimiento',
  '/rentabilidad': 'rentabilidad',
  '/inmuebles': 'inmuebles',
  '/tedee': 'tedee',
  '/ajustes': 'ajustes',
};

const COLLAPSE_KEY = 'keynest-sidebar-collapsed';

/* Orden completo de vistas (dominio + Ajustes al final): define la dirección
   del deslizamiento móvil (forward/back) igual que el nav de Helios. */
const NAV_ORDER: { to: string }[] = [...NAV_ITEMS, SETTINGS_ITEM];

function navIndex(path: string): number {
  const active = (to: string) => (to === '/' ? path === '/' : path.startsWith(to));
  return NAV_ORDER.findIndex(({ to }) => active(to));
}

function ThemeToggle() {
  const { mode, setMode, resolved } = useTheme();
  const { t } = useTranslation();
  const reduce = useReducedMotion();

  const OPTIONS: { value: 'system' | 'light' | 'dark'; key: string; icon: typeof Sun }[] = [
    { value: 'system', key: 'aj.sistema', icon: Sunrise },
    { value: 'light', key: 'aj.claro', icon: Sun },
    { value: 'dark', key: 'aj.oscuro', icon: Moon },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t('aj.tema')}
      className="flex h-8 items-center rounded-full border p-0.5"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      {OPTIONS.map(({ value, key, icon: Icon }) => {
        const active = mode === value;
        const label = t(key);
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setMode(value)}
            className="relative flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: active ? 'var(--surface-2)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={active ? `${value}-on` : `${value}-off`}
                initial={reduce ? false : { rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={reduce ? {} : { rotate: 90, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="flex"
              >
                <Icon size={15} strokeWidth={2.2} />
              </motion.span>
            </AnimatePresence>
            <span className="hidden sm:inline">{label}</span>
            {value === 'system' && active && (
              <span
                className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: resolved === 'dark' ? 'rgb(165 180 252)' : 'rgb(245 158 11)' }}
                aria-label={resolved === 'dark' ? t('aj.oscuro') : t('aj.claro')}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Botón único de tema para móvil: cicla system → light → dark, icono rota al cambiar. */
function ThemeCycleButton() {
  const { mode, setMode, resolved } = useTheme();
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const CYCLE: ThemeMode[] = ['system', 'light', 'dark'];
  const Icon =
    mode === 'dark' ? Moon : mode === 'light' ? Sun : resolved === 'dark' ? Moon : Sunrise;
  const next = () => setMode(CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length]);
  return (
    <button
      type="button"
      onClick={next}
      aria-label={t('aj.tema')}
      className="flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-150 hover:bg-[var(--surface-2)]"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={mode}
          initial={reduce ? false : { rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={reduce ? {} : { rotate: 90, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="flex"
        >
          <Icon size={17} strokeWidth={2.2} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function UserButton({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const user = cachedUser();
  if (!user) return null;
  const name = user.display_name || user.username || '';
  const initials = (user.username ?? '')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <NavLink
      to="/ajustes"
      aria-label={t('nav.ajustes')}
      className={cn(
        'flex h-9 items-center gap-2 rounded-xl transition-colors duration-150 hover:bg-[var(--surface-2)]',
        compact ? 'w-9 justify-center' : 'px-1.5',
      )}
    >
      {user.avatar ? (
        <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full">
          <img src={user.avatar} alt="" className="h-full w-full object-cover" />
        </span>
      ) : (
        <PersonAvatar name={name} initials={initials} size={28} />
      )}
      {!compact && (
        <span className="hidden max-w-[110px] truncate text-sm font-medium sm:inline" style={{ color: 'var(--text)' }}>
          {name}
        </span>
      )}
    </NavLink>
  );
}

function ConnectionDot({ withLabel = false }: { withLabel?: boolean }) {
  const { connectionStatus } = useData();
  const { t } = useTranslation();
  const live = connectionStatus === 'connected';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full text-[11px] font-medium"
      style={{ color: 'var(--text-faint)' }}
      role="status"
      aria-label={live ? t('nav.conectado') : t('nav.reconectando')}
    >
      <span className="relative flex h-2 w-2">
        {!live && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-400'}`}
        />
      </span>
      {withLabel && (live ? t('nav.conectado') : t('nav.reconectando'))}
    </span>
  );
}

function LogoMark({ size = 28 }: { size?: number }) {
  return <img src="/logo.svg" alt="Keynest" width={size} height={size} style={{ width: size, height: size }} />;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const isMobile = useIsMobile();
  const { getUrgentMaintenance } = useData();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* noop */
    }
  }, [collapsed]);

  // Cada cambio de ruta resetea el scroll al principio (no hay ScrollRestoration).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const urgentMaintenance = getUrgentMaintenance().length;

  const sessionUser = cachedUser();

  // Aviso proactivo de versión nueva del propio servidor (anti pantalla-negra):
  // poll 10 min + visibilitychange; desactivado en demo.
  const updateAvailable = useUpdateAvailable(!sessionUser?.is_demo);

  // Toast de confirmación post-update: si /api/version trae pendingUpdate
  // (el servidor se reinició tras un apply), muestra un aviso.
  useEffect(() => {
    if (sessionUser?.is_demo) return;
    const check = async () => {
      try {
        const res = await fetch('/api/version', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.pendingUpdate?.to) {
          toast.success(t('update.toastUpdated', { v: data.pendingUpdate.to }));
        }
      } catch { /* noop */ }
    };
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser]);

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
  const titleKey = TITLE_KEYS[location.pathname];
  const title = titleKey ? t(`nav.${titleKey}`) : 'Keynest';
  /* Rutas no directas (ocultas del nav): en móvil muestran flecha "Volver" */
  const isSecondary = HIDDEN_ROUTES.includes(location.pathname);

  const badgeFor = (to: string): number => {
    if (to === '/mantenimiento') return urgentMaintenance;
    return 0;
  };

  /* Re-tap del tab activo (o logo): scroll suave arriba. Si la ruta es distinta,
     el Link navega normal (el scroll se resetea con el useEffect de pathname). */
  const scrollTopIfActive = (to: string) => () => {
    if (isActive(to) && window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    }
  };

  /* Navegación móvil con deslizamiento (#198): el modo declarativo
   * (BrowserRouter) no soporta la prop viewTransition de react-router (solo
   * RouterProvider), así que interceptamos el click y envolvemos la navegación
   * en document.startViewTransition (con flushSync, igual que hace react-router
   * internamente). La dirección se marca en <html data-nav-dir> antes del
   * snapshot; el shell (header + bottom nav) queda estático vía CSS. */
  const handleMobileNav = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const from = navIndex(location.pathname);
    const target = navIndex(to);
    if (target !== -1 && from !== target) {
      try {
        document.documentElement.dataset.navDir = from === -1 || target > from ? 'forward' : 'back';
      } catch {
        /* sin dataset */
      }
      scrollTopIfActive(to)();
      const doNavigate = () => navigate(to);
      if (typeof document.startViewTransition === 'function') {
        document.startViewTransition(() => flushSync(doNavigate));
      } else {
        doNavigate();
      }
    } else {
      scrollTopIfActive(to)();
      navigate(to, { replace: true });
    }
  };

  /* ------------------------------------------------ Item solo-icono (raíl/colapsado) */
  const renderIconItem = (item: NavItem) => {
    const active = isActive(item.to);
    const badge = badgeFor(item.to);
    return (
      <Tooltip key={item.to} delayDuration={150}>
        <TooltipTrigger asChild>
          <NavLink
            to={item.to}
            aria-label={t(`nav.${item.labelKey}`)}
            className={cn(
              'relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-150 hover:bg-[var(--surface-2)]',
              active ? 'text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
            style={active ? { backgroundColor: 'var(--surface-2)' } : undefined}
          >
            {active && (
              <motion.span
                layoutId="nav-dot"
                transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 500, damping: 40 }}
                className="brand-gradient absolute -left-[13px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
              />
            )}
            <item.icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
            {badge > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                {badge}
              </span>
            )}
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right" className="rounded-lg border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-overlay">
          {t(`nav.${item.labelKey}`)}
        </TooltipContent>
      </Tooltip>
    );
  };

  /* ---------------------------------------------------------- Sidebar item */
  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.to);
    const badge = badgeFor(item.to);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={cn(
          'relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-150 hover:bg-[var(--surface-2)]',
          active ? 'text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
        )}
        style={active ? { backgroundColor: 'var(--surface-2)' } : undefined}
      >
        {active && (
          <motion.span
            layoutId="nav-bar"
            transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 500, damping: 40 }}
            className="brand-gradient absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
            style={{ originY: 0.5 }}
          />
        )}
        <item.icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
        <span className="flex-1 truncate">{t(`nav.${item.labelKey}`)}</span>
        {badge > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">
            {badge}
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <TooltipProvider>
      <div className="min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)' }}>
        {/* ============================== Sidebar desktop (≥ lg) */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 hidden flex-col border-r transition-[width] duration-250 ease-out-quart lg:flex',
          )}
          style={{
            width: collapsed ? 64 : 232,
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            transitionDuration: '250ms',
          }}
        >
          <div className={cn('flex items-center gap-2.5 px-5 pt-5 pb-4', collapsed && 'justify-center px-0')}>
            <Link to="/" aria-label={t('nav.irResumen')} className="flex items-center gap-2.5">
              <LogoMark size={28} />
              {!collapsed && (
                <span className="font-display text-lg font-bold tracking-[-0.02em] transition-opacity duration-150">
                  Keynest
                </span>
              )}
            </Link>
          </div>

          {collapsed ? (
            <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-3 py-2">
              {[...DESKTOP_NAV, SETTINGS_ITEM].map(renderIconItem)}
            </nav>
          ) : (
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
              {DESKTOP_NAV.map(renderNavItem)}
            </nav>
          )}

          {/* Pie: [conexión | ajustes | colapsar]. El tema vive en la topbar (issue #151). */}
          <div className={cn('flex flex-col gap-2 border-t p-3', collapsed && 'items-center')} style={{ borderColor: 'var(--border)' }}>
            {collapsed ? (
              <>
                <ConnectionDot />
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => !c)}
                  aria-label={t('nav.expandirMenu')}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-150 hover:bg-[var(--surface-2)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <ConnectionDot withLabel />
                <NavLink
                  to={SETTINGS_ITEM.to}
                  className={cn(
                    'relative flex h-9 flex-1 items-center justify-center gap-2.5 rounded-xl px-3 text-sm font-medium transition-colors duration-150',
                    isActive(SETTINGS_ITEM.to) ? 'text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                  )}
                  style={isActive(SETTINGS_ITEM.to) ? { backgroundColor: 'var(--surface-2)' } : undefined}
                >
                  <SETTINGS_ITEM.icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                  {t('nav.ajustes')}
                </NavLink>
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => !c)}
                  aria-label={t('nav.colapsarMenu')}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-150 hover:bg-[var(--surface-2)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* ============================== Raíl tablet (md, por breakpoint) */}
        <aside
          className="fixed inset-y-0 left-0 z-40 hidden w-16 flex-col items-center border-r py-3 md:flex lg:hidden"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <Link to="/" aria-label={t('nav.irResumen')} className="flex h-10 items-center justify-center">
            <LogoMark size={26} />
          </Link>
          <nav className="mt-3 flex flex-1 flex-col items-center gap-1 overflow-y-auto">
            {[...DESKTOP_NAV, SETTINGS_ITEM].map(renderIconItem)}
          </nav>
          <ConnectionDot />
        </aside>

        {/* ============================== Header móvil (< md) */}
        <header
          className="[view-transition-name:keynest-header] fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b px-4 backdrop-blur-md md:hidden"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--surface) 85%, transparent)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex w-10 items-center">
            {isSecondary ? (
              <button
                type="button"
                onClick={() => navigate(-1)}
                aria-label="Volver"
                className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: 'var(--text-muted)' }}
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : (
              <Link to="/" aria-label={t('nav.irResumen')} onClick={handleMobileNav('/')}>
                <LogoMark size={26} />
              </Link>
            )}
          </div>
          <h1 className="flex-1 text-center font-display text-[17px] font-semibold tracking-[-0.01em]">
            {title}
          </h1>
           <div className="flex w-auto items-center gap-1.5">
             <ThemeCycleButton />
             <NotificationsPopover />
             <UserButton compact />
           </div>
        </header>

        {/* ============================== Contenido */}
        <div
          className="transition-[margin] ease-out-quart md:pl-16 lg:pl-[var(--sbw)]"
          style={{ ['--sbw' as string]: collapsed ? '64px' : '232px', transitionDuration: '250ms' }}
        >
          {/* Topbar desktop/tablet (canon webapp-shell): título a la izquierda,
              usuario (avatar + nombre → /ajustes) a la derecha */}
          <header className="sticky top-0 z-30 hidden h-14 items-center justify-between border-b px-6 backdrop-blur-md md:flex"
            style={{ borderColor: 'var(--border)', backgroundColor: 'color-mix(in srgb, var(--surface) 85%, transparent)' }}>
            <h1 className="font-display text-xl font-semibold tracking-[-0.01em]">{title}</h1>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <NotificationsPopover />
              <UserButton />
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-[72px] md:px-8 md:pb-10 md:pt-7">
            <Toaster position="top-center" />
            <PullToRefresh>
            {updateAvailable && (
              <div
                role="status"
                className="mb-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold"
                style={{
                  borderColor: 'rgb(99 102 241 / 0.35)',
                  backgroundColor: 'rgb(99 102 241 / 0.1)',
                  color: '#6366F1',
                }}
              >
                <span className="h-2 w-2 shrink-0 animate-ping rounded-full" style={{ backgroundColor: '#6366F1' }} />
                <span className="flex-1">{t('update.banner')}</span>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="flex h-8 shrink-0 items-center rounded-lg px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#6366F1' }}
                >
                  {t('update.reload')}
                </button>
              </div>
            )}
            {sessionUser?.role === 'admin' && <UpdateRibbon />}
            <AirbnbSessionRibbon />
            {sessionUser?.is_demo && (
              <div
                role="status"
                className="mb-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold"
                style={{
                  borderColor: 'rgb(245 158 11 / 0.35)',
                  backgroundColor: 'rgb(245 158 11 / 0.1)',
                  color: '#F59E0B',
                }}
              >
                <span className="animate-ping-soft h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
                <span>{t('nav.demoBanner')}</span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="ml-auto flex h-8 items-center rounded-lg border px-3 text-xs font-medium transition-colors"
                  style={{ borderColor: 'rgb(245 158 11 / 0.4)', color: '#F59E0B' }}
                >
                  {t('nav.demoSalir')}
                </button>
              </div>
            )}
            {/* En móvil usamos view transitions para el deslizamiento entre
                vistas (#198): el fade/y de framer-motion se desactiva porque su
                estado inicial (opacity 0) quedaría congelado en el snapshot. */}
            {isMobile ? (
              <div>{children}</div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={location.pathname}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={
                    reduce
                      ? { duration: 0.15 }
                      : { duration: 0.25, ease: EASE_OUT_QUART }
                  }
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            )}
            </PullToRefresh>
            <p className="pointer-events-none fixed bottom-[68px] right-2 z-30 hidden text-[9px] font-medium md:bottom-2 md:right-3 md:block" style={{ color: 'var(--text-faint)' }}>
              v{APP_VERSION}
            </p>
          </main>
        </div>

        {/* ============================== Bottom-nav móvil (< md) */}
        <nav
          className="[view-transition-name:keynest-nav] fixed inset-x-0 bottom-0 z-40 border-t md:hidden"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--surface) 92%, transparent)',
            borderColor: 'var(--border)',
            backdropFilter: 'blur(12px)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="grid h-16 grid-cols-4">
            {BOTTOM_ITEMS.map((item) => {
              const active = isActive(item.to);
              const badge = badgeFor(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={handleMobileNav(item.to)}
                  className="relative flex flex-col items-center justify-center gap-0.5"
                >
                  {active && (
                    <motion.span
                      layoutId="bottomnav-pill"
                      transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 500, damping: 40 }}
                      className="absolute top-1.5 h-8 w-14 rounded-xl"
                      style={{ backgroundColor: 'rgb(var(--accent-rgb) / 0.12)' }}
                    />
                  )}
                  <span className="relative">
                    <item.icon
                      className="h-5 w-5"
                      strokeWidth={active ? 2.2 : 1.8}
                      style={{ color: active ? 'var(--brand-from)' : 'var(--text-faint)' }}
                    />
                    {badge > 0 && (
                      <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                        {badge}
                      </span>
                    )}
                  </span>
                  <span
                    className="relative text-[10px] font-semibold"
                    style={{ color: active ? '#6366F1' : 'var(--text-faint)' }}
                  >
                    {t(`nav.${item.labelKey}`)}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </TooltipProvider>
  );
}
