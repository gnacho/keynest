import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';
export type EffectiveTheme = 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

const SLUG = 'keynest';
const MODE_KEY = `${SLUG}-theme-mode`;
const LEGACY_MODE_KEY = `${SLUG}-theme`; // clave antigua (bi-estado), se migra a MODE_KEY
const DENSITY_KEY = `${SLUG}-density`;
const REDUCE_MOTION_KEY = `${SLUG}-reduce-motion`;

const THEME_COLORS: Record<EffectiveTheme, string> = {
  light: '#F4F6FA',
  dark: '#080D1A',
};

function resolveSystem(): EffectiveTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function initialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(MODE_KEY) ?? localStorage.getItem(LEGACY_MODE_KEY);
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
  } catch {
    /* sin localStorage */
  }
  return 'system';
}

function applyTheme(effective: EffectiveTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', effective === 'dark');
  root.classList.toggle('light', effective === 'light');
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.setAttribute('content', THEME_COLORS[effective]);
}

function applyDensity(density: Density) {
  document.documentElement.style.fontSize = density === 'compact' ? '13.5px' : '16px';
}

/** Anti-FOUC: aplicar preferencias antes del primer render (main.tsx). */
export function applyBootPreferences() {
  try {
    const mode = initialMode();
    applyTheme(mode === 'system' ? resolveSystem() : mode);
    const density = localStorage.getItem(DENSITY_KEY);
    if (density === 'compact' || density === 'comfortable') applyDensity(density);
    if (localStorage.getItem(REDUCE_MOTION_KEY) === '1') {
      document.documentElement.classList.add('reduce-motion');
    }
  } catch {
    /* sin localStorage */
  }
}

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolved: EffectiveTheme;
  isDark: boolean;
  toggle: () => void;
  density: Density;
  setDensity: (d: Density) => void;
  reduceMotion: boolean;
  setReduceMotion: (v: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(resolveSystem);
  const [density, setDensityState] = useState<Density>(() => {
    try {
      return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
    } catch {
      return 'comfortable';
    }
  });
  const [reduceMotion, setReduceMotionState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(REDUCE_MOTION_KEY) === '1';
    } catch {
      return false;
    }
  });

  const resolved: EffectiveTheme = mode === 'system' ? systemTheme : mode;

  // Listener de matchMedia EN EL PROVIDER: reacciona al SO siempre que el modo sea system.
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystemTheme(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
      localStorage.removeItem(LEGACY_MODE_KEY);
    } catch {
      /* sin localStorage */
    }
  }, []);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    try {
      localStorage.setItem(DENSITY_KEY, next);
    } catch {
      /* sin localStorage */
    }
  }, []);

  const setReduceMotion = useCallback((next: boolean) => {
    setReduceMotionState(next);
    try {
      localStorage.setItem(REDUCE_MOTION_KEY, next ? '1' : '0');
      document.documentElement.classList.toggle('reduce-motion', next);
    } catch {
      /* sin localStorage */
    }
  }, []);

  const toggle = useCallback(() => setMode(resolved === 'dark' ? 'light' : 'dark'), [resolved, setMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
      resolved,
      isDark: resolved === 'dark',
      toggle,
      density,
      setDensity,
      reduceMotion,
      setReduceMotion,
    }),
    [mode, setMode, resolved, toggle, density, setDensity, reduceMotion, setReduceMotion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}
