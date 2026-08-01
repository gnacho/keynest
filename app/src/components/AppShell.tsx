import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Moon,
  MoreHorizontal,
  Settings,
  Sparkles,
  Sun,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import PersonAvatar from '@/components/PersonAvatar';
import { useTheme } from '@/theme/theme-context';
import { useData } from '@/data/useData';
import { cachedUser } from '@/lib/auth';
import { cn } from '@/lib/utils';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'resumen', icon: LayoutDashboard },
  { to: '/calendario', labelKey: 'calendario', icon: CalendarDays },
  { to: '/reservas', labelKey: 'reservas', icon: BookOpen },
  { to: '/limpieza', labelKey: 'limpieza', icon: Sparkles },
  { to: '/mantenimiento', labelKey: 'mantenimiento', icon: Wrench },
  { to: '/rentabilidad', labelKey: 'rentabilidad', icon: TrendingUp },
  { to: '/ajustes', labelKey: 'ajustes', icon: Settings },
];

const BOTTOM_ITEMS: NavItem[] = NAV_ITEMS.slice(0, 4);
const MORE_ITEMS: NavItem[] = NAV_ITEMS.slice(4);

const TITLE_KEYS: Record<string, string> = {
  '/': 'resumen',
  '/calendario': 'calendario',
  '/reservas': 'reservas',
  '/limpieza': 'limpieza',
  '/mantenimiento': 'mantenimiento',
  '/rentabilidad': 'rentabilidad',
  '/ajustes': 'ajustes',
};

const COLLAPSE_KEY = 'keynest-sidebar-collapsed';

function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? t('nav.temaClaro') : t('nav.temaOscuro')}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-150 hover:bg-[var(--surface-2)]',
        className,
      )}
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
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
  const { getPendingCleanings, getUrgentMaintenance } = useData();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* noop */
    }
  }, [collapsed]);

  // (El Sheet "Más" se cierra al pulsar cualquiera de sus enlaces)

  const pendingCleanings = getPendingCleanings().length;
  const urgentMaintenance = getUrgentMaintenance().length;

  const sessionUser = cachedUser();
  const sessionName = sessionUser?.username ?? 'Usuario';
  const sessionInitials = sessionName.slice(0, 2).toUpperCase();
  const sessionRole = sessionUser?.is_demo ? t('nav.demoBadge') : sessionUser?.role === 'admin' ? 'Admin' : (sessionUser?.role ?? '');

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
  const moreActive = MORE_ITEMS.some((i) => isActive(i.to));
  const titleKey = TITLE_KEYS[location.pathname];
  const title = titleKey ? t(`nav.${titleKey}`) : 'Keynest';
  const isSecondary = MORE_ITEMS.some((i) => i.to === location.pathname);

  const badgeFor = (to: string): number => {
    if (to === '/limpieza') return pendingCleanings;
    if (to === '/mantenimiento') return urgentMaintenance;
    return 0;
  };

  /* ---------------------------------------------------------- Sidebar item */
  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.to);
    const badge = badgeFor(item.to);
    const content = (
      <NavLink
        to={item.to}
        className={cn(
          'relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-150',
          active ? 'text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
          collapsed && 'justify-center px-0',
        )}
        style={active ? { backgroundColor: 'var(--surface-2)' } : undefined}
      >
        {active &&
          (collapsed ? (
            <motion.span
              key={`dot-${location.pathname}`}
              initial={reduce ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.2, ease: EASE_OUT_QUART }}
              className="brand-gradient absolute -left-[13px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
            />
          ) : (
            <motion.span
              key={`bar-${location.pathname}`}
              initial={reduce ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.2, ease: EASE_OUT_QUART }}
              className="brand-gradient absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
              style={{ originY: 0.5 }}
            />
          ))}
        <item.icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
        <span
          className={cn(
            'flex-1 truncate transition-opacity duration-150',
            collapsed ? 'hidden opacity-0' : 'opacity-100',
          )}
        >
          {t(`nav.${item.labelKey}`)}
        </span>
        {!collapsed && badge > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">
            {badge}
          </span>
        )}
      </NavLink>
    );

    if (collapsed) {
      return (
        <Tooltip key={item.to} delayDuration={150}>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="right" className="rounded-lg border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-overlay">
            {t(`nav.${item.labelKey}`)}
          </TooltipContent>
        </Tooltip>
      );
    }
    return <div key={item.to}>{content}</div>;
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
            width: collapsed ? 72 : 232,
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

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
            {NAV_ITEMS.map(renderNavItem)}
          </nav>

          <div className={cn('flex flex-col gap-2 border-t p-3', collapsed && 'items-center')} style={{ borderColor: 'var(--border)' }}>
            <div className={cn('flex items-center gap-2.5 rounded-xl p-1.5', collapsed && 'justify-center')}>
              <PersonAvatar name={sessionName} initials={sessionInitials} size={32} />
              {!collapsed && (
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[13px] font-semibold">{sessionName}</p>
                  <p className="text-[11px]" style={{ color: sessionUser?.is_demo ? '#F59E0B' : 'var(--text-faint)' }}>
                    {sessionRole}
                  </p>
                </div>
              )}
              {!collapsed && <ThemeToggle />}
            </div>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? t('nav.expandirMenu') : t('nav.colapsarMenu')}
              className="flex h-8 items-center justify-center gap-2 rounded-xl text-xs font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
              style={{ color: 'var(--text-faint)' }}
            >
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
              {!collapsed && t('nav.colapsar')}
            </button>
          </div>
        </aside>

        {/* ============================== Header móvil (< lg) */}
        <header
          className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b px-4 backdrop-blur-md lg:hidden"
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
            <ThemeToggle />
            <PersonAvatar name={sessionName} initials={sessionInitials} size={32} />
          </div>
        </header>

        {/* ============================== Contenido */}
        <div
          className="transition-[margin] ease-out-quart lg:pl-[var(--sbw)]"
          style={{ ['--sbw' as string]: collapsed ? '72px' : '232px', transitionDuration: '250ms' }}
        >
          <main className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-[72px] lg:px-8 lg:pb-10 lg:pt-7">
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
          </main>
        </div>

        {/* ============================== Bottom-nav móvil (< lg) */}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t lg:hidden"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--surface) 92%, transparent)',
            borderColor: 'var(--border)',
            backdropFilter: 'blur(12px)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="grid h-16 grid-cols-5">
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
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="relative flex flex-col items-center justify-center gap-0.5"
            >
              {moreActive && (
                <motion.span
                  layoutId="bottomnav-pill"
                  transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 500, damping: 40 }}
                  className="absolute top-1.5 h-8 w-14 rounded-xl"
                  style={{ backgroundColor: 'rgb(99 102 241 / 0.12)' }}
                />
              )}
              <span className="relative">
                <MoreHorizontal
                  className="h-5 w-5"
                  style={{ color: moreActive ? '#6366F1' : 'var(--text-faint)' }}
                />
                {urgentMaintenance > 0 && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                    {urgentMaintenance}
                  </span>
                )}
              </span>
              <span
                className="relative text-[10px] font-semibold"
                style={{ color: moreActive ? '#6366F1' : 'var(--text-faint)' }}
              >
                {t('nav.mas')}
              </span>
            </button>
          </div>
        </nav>

        {/* ============================== Sheet "Más" */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent
            side="bottom"
            className="rounded-t-3xl border-[var(--border)] bg-[var(--surface)] pb-[calc(24px+env(safe-area-inset-bottom))]"
          >
            <SheetHeader className="pb-2 text-left">
              <SheetTitle className="font-display text-lg font-semibold">{t('nav.mas')}</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-2">
              {MORE_ITEMS.map((item) => {
                const active = isActive(item.to);
                const badge = badgeFor(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className="relative flex items-center gap-3 rounded-2xl border p-4 transition-colors duration-150 hover:bg-[var(--surface-2)]"
                    style={{
                      borderColor: active ? '#6366F1' : 'var(--border)',
                      backgroundColor: active ? 'rgb(99 102 241 / 0.08)' : 'var(--surface)',
                    }}
                  >
                    <item.icon className="h-5 w-5" style={{ color: active ? '#6366F1' : 'var(--text-muted)' }} />
                    <span className="text-sm font-semibold">{t(`nav.${item.labelKey}`)}</span>
                    {badge > 0 && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
