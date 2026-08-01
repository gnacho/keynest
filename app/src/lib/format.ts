/**
 * Formato por idioma (i18n): es-ES (coma decimal, miles con punto) / en-US.
 * Los formateadores Intl se cachean y se reconstruyen al cambiar de idioma.
 */
import i18n, { intlLocale } from '@/i18n';

let cache: Record<string, Intl.NumberFormat | Intl.DateTimeFormat> = {};
i18n.on('languageChanged', () => {
  cache = {};
});

function num(key: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = `n:${key}`;
  if (!cache[k]) cache[k] = new Intl.NumberFormat(intlLocale(), opts);
  return cache[k] as Intl.NumberFormat;
}

function dt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `d:${key}`;
  if (!cache[k]) cache[k] = new Intl.DateTimeFormat(intlLocale(), opts);
  return cache[k] as Intl.DateTimeFormat;
}

/** 1240 → "1.240 €" / "€1,240" · 39,99 → "39,99 €" */
export function fmtMoney(value: number, decimals?: boolean): string {
  const hasDecimals = Math.abs(value % 1) > 0.004;
  const eur = num('eur', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur0 = num('eur0', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (decimals === true) return eur.format(value);
  if (decimals === false) return eur0.format(value);
  return hasDecimals ? eur.format(value) : eur0.format(value);
}

/** Cifra sin símbolo: 12345.6 → "12.345,6" */
export function fmtNumber(value: number, decimals = 0): string {
  return decimals > 0
    ? num('num1', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
    : num('num', { maximumFractionDigits: 0 }).format(value);
}

/** 12.4 → "12,4 %" */
export function fmtPct(value: number, decimals = 1): string {
  return `${num(`pct${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)} %`;
}

/** "martes, 14 de mayo" / "Tuesday, May 14" */
export function fmtDateFull(d: Date): string {
  return dt('full', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

/** "14 may" / "May 14" */
export function fmtDateShort(d: Date): string {
  return dt('short', { day: 'numeric', month: 'short' }).format(d).replace('.', '');
}

/** "14 may 2026" / "May 14, 2026" */
export function fmtDateShortYear(d: Date): string {
  return dt('shortY', { day: 'numeric', month: 'short', year: 'numeric' }).format(d).replace(/\./g, '');
}

/** Rango "14 may → 20 may"; si cruza años, con año en ambas: "30 dic 2026 → 10 ene 2027" */
export function fmtDateRangeShort(a: Date, b: Date): string {
  const cross = a.getFullYear() !== b.getFullYear();
  const f = cross ? fmtDateShortYear : fmtDateShort;
  return `${f(a)} → ${f(b)}`;
}

/** "14 de mayo de 2025" / "May 14, 2025" */
export function fmtDateLong(d: Date): string {
  return dt('long', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

/** "mayo" / "May" */
export function fmtMonth(d: Date, short = false): string {
  return dt(short ? 'monS' : 'monL', { month: short ? 'short' : 'long' }).format(d).replace('.', '');
}

/** "hace 2 h", "ayer" / "2 h ago", "yesterday" */
export function fmtRelative(d: Date, now = new Date()): string {
  const diffMs = now.getTime() - d.getTime();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const past = diffMs >= 0;
  if (minutes < 1) return i18n.t('time.ahora');
  if (minutes < 60) return i18n.t(past ? 'time.haceMin' : 'time.enMin', { n: minutes });
  if (hours < 24) return i18n.t(past ? 'time.haceH' : 'time.enH', { n: hours });
  if (days === 1) return i18n.t(past ? 'time.ayer' : 'time.manana');
  return i18n.t(past ? 'time.haceDias' : 'time.enDias', { n: days });
}

/** "15:00" */
export function fmtTime(d: Date): string {
  return d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function addDays(d: Date, days: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
}

export function addMonths(d: Date, months: number): Date {
  const c = new Date(d);
  c.setMonth(c.getMonth() + months);
  return c;
}

/** Fin de retención de fotos de una limpieza: 1 mes desde la salida. */
export function photoRetentionUntil(cleaningDate: Date): Date {
  return addMonths(cleaningDate, 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
