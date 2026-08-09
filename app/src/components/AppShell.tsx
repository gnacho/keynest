import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Moon,
  Settings,
  Sparkles,
  Sun,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import PersonAvatar from '@/components/PersonAvatar';
import UpdateRibbon from '@/components/UpdateRibbon';
import AirbnbSessionRibbon from '@/components/AirbnbSessionRibbon';
import PullToRefresh from '@/components/PullToRefresh';
import NotificationsPopover from '@/components/NotificationsPopover';
import { useUpdateAvailable } from '@/hooks/useUpdateAvailable';
import { useTheme } from '@/theme/ThemeProvider';
import { useData } from '@/data/useData';
import { cachedUser, logout } from '@/lib/auth';
import { cn } from '@/lib/utils';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

/* Items de dominio; Ajustes NO va en el nav principal del sidebar: va abajo,
   junto al ThemeToggle (webapp-shell). En móvil entra en la bottom-nav directa. */
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
];

/* Desktop: todos los de dominio */
const DESKTOP_NAV: NavItem[] = NAV_ITEMS;

/* Móvil (bottom-nav): solo los esenciales + Ajustes */
const HIDDEN_ROUTES = ['/calendario', '/mantenimiento'];
const VISIBLE_NAV: NavItem[] = NAV_ITEMS.filter((i) => !HIDDEN_ROUTES.includes(i.to));

const SETTINGS_ITEM: NavItem = { to: '/ajustes', labelKey: 'ajustes', icon: Settings };

/* Móvil (bottom-nav): esenciales (Resumen/Reservas/Limpieza/Rentabilidad) sin
   Ajustes — Ajustes se accede desde el avatar de usuario del header. */
const BOTTOM_ITEMS: NavItem[] = VISIBLE_NAV;

const TITLE_KEYS: Record<string, string> = {
  '/': 'resumen',
  '/calendario': 'calendario',
  '/reservas': 'reservas',
  '/limpieza': 'limpieza',
  '/mantenimiento': 'mantenimiento',
  '/rentabilidad': 'rentabilidad',
  '/tedee': 'tedee',
  '/ajustes': 'ajustes',
};

const COLLAPSE_KEY = 'keynest-sidebar-collapsed';

function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={resolved === 'dark' ? t('nav.temaClaro') : t('nav.temaOscuro')}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-150 hover:bg-[var(--surface-2)]',
        className,
      )}
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      {resolved === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
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

  const urgentMaintenance = getUrgentMaintenance().length;

  const sessionUser = cachedUser();
  const sessionName = sessionUser?.username ?? 'Usuario';
  const sessionInitials = sessionName.slice(0, 2).toUpperCase();

  // Aviso proactivo de versión nueva del propio servidor (anti pantalla-negra):
  // poll 10 min + visibilitychange; desactivado en demo.
  const updateAvailable = useUpdateAvailable(!sessionUser?.is_demo);

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
              'relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-150',
              active ? 'text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
            style={active ? { backgroundColor: 'var(--surface-2)' } : undefined}
          >
            {active && (
              <motion.span
                key={`dot-${location.pathname}`}
                initial={reduce ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.2, ease: EASE_OUT_QUART }}
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
          'relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-150',
          active ? 'text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
        )}
        style={active ? { backgroundColor: 'var(--surface-2)' } : undefined}
      >
        {active && (
          <motion.span
            key={`bar-${location.pathname}`}
            initial={reduce ? false : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.2, ease: EASE_OUT_QUART }}
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

          {/* Pie canon webapp-shell: [tema | ajustes | colapsar] en una fila.
              El usuario (avatar+nombre) vive en la topbar, no aquí (5-Ago-2026). */}
          <div className={cn('flex flex-col gap-2 border-t p-3', collapsed && 'items-center')} style={{ borderColor: 'var(--border)' }}>
            {collapsed ? (
              <>
                <ThemeToggle />
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
                <ThemeToggle />
                <NavLink
                  to={SETTINGS_ITEM.to}
                  className={cn(
                    'relative flex h-9 flex-1 items-center gap-2.5 rounded-xl px-3 text-sm font-medium transition-colors duration-150',
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
          <ThemeToggle />
        </aside>

        {/* ============================== Header móvil (< md) */}
        <header
          className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b px-4 backdrop-blur-md md:hidden"
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
              <Link to="/" aria-label={t('nav.irResumen')}>
                <LogoMark size={26} />
              </Link>
            )}
          </div>
          <h1 className="flex-1 text-center font-display text-[17px] font-semibold tracking-[-0.01em]">
            {title}
          </h1>
          <div className="flex w-auto items-center gap-1.5">
            <NotificationsPopover />
            <ThemeToggle />
            <Link to={SETTINGS_ITEM.to} aria-label={t(`nav.${SETTINGS_ITEM.labelKey}`)}>
              <PersonAvatar name={sessionName} initials={sessionInitials} size={32} />
            </Link>
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
              <NotificationsPopover />
              <NavLink
                to={SETTINGS_ITEM.to}
                className="flex items-center gap-2.5 rounded-xl p-1.5 transition-colors duration-150 hover:bg-[var(--surface-2)]"
              >
                <PersonAvatar name={sessionName} initials={sessionInitials} size={30} />
                <span className="hidden text-[13px] font-semibold lg:inline">{sessionName}</span>
              </NavLink>
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
            </PullToRefresh>
          </main>
        </div>

        {/* ============================== Bottom-nav móvil (< md) */}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t md:hidden"
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
                  className="relative flex flex-col items-center justify-center gap-0.5"
                >
                  {active && (
                    <motion.span
                      layoutId="bottomnav-pill"
                      transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 500, damping: 40 }}
                      className="absolute top-1.5 h-8 w-14 rounded-xl"
                      style={{ backgroundColor: 'rgb(99 102 241 / 0.12)' }}
                    />
                  )}
                  <span className="relative">
                    <item.icon
                      className="h-5 w-5"
                      strokeWidth={active ? 2.2 : 1.8}
                      style={{ color: active ? '#6366F1' : 'var(--text-faint)' }}
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
