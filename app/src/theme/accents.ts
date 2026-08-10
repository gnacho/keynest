export interface AccentPreset {
  id: string;
  label: string;
  from: string;
  to: string;
  rgb: string;
}

export const ACCENTS: AccentPreset[] = [
  { id: 'indigo', label: 'Índigo', from: '#6366F1', to: '#8B5CF6', rgb: '99 102 241' },
  { id: 'rose', label: 'Rosa', from: '#F43F5E', to: '#FB7185', rgb: '244 63 94' },
  { id: 'emerald', label: 'Esmeralda', from: '#10B981', to: '#34D399', rgb: '16 185 129' },
  { id: 'blue', label: 'Azul', from: '#3B82F6', to: '#60A5FA', rgb: '59 130 246' },
  { id: 'amber', label: 'Ámbar', from: '#F59E0B', to: '#FBBF24', rgb: '245 158 11' },
  { id: 'violet', label: 'Violeta', from: '#8B5CF6', to: '#A78BFA', rgb: '139 92 246' },
];

const ACCENT_STORAGE_KEY = 'keynest-accent';

export function getStoredAccent(): string {
  try {
    return localStorage.getItem(ACCENT_STORAGE_KEY) ?? 'indigo';
  } catch {
    return 'indigo';
  }
}

export function storeAccent(id: string): void {
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, id);
  } catch { /* noop */ }
}

function accentById(id: string): AccentPreset {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

function lightenRgb(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `${r} ${g} ${b}`;
}

/** Apply accent CSS variables to <html>. Call from ThemeProvider and from boot script. */
export function applyAccent(id: string, isDark: boolean): void {
  const a = accentById(id);
  const root = document.documentElement;
  root.setAttribute('data-accent', id);
  if (isDark) {
    root.style.setProperty('--brand-from', lightenRgbHex(a.from, 60));
    root.style.setProperty('--brand-to', lightenRgbHex(a.to, 60));
    root.style.setProperty('--accent-rgb', lightenRgb(a.from, 100));
  } else {
    root.style.setProperty('--brand-from', a.from);
    root.style.setProperty('--brand-to', a.to);
    root.style.setProperty('--accent-rgb', a.rgb);
  }
}

function lightenRgbHex(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
