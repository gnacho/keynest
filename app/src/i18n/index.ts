import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './locales/es/translation.json';
import en from './locales/en/translation.json';

export type AppLanguage = 'auto' | 'es' | 'en';

/** 'auto' → idioma del navegador (fallback es). */
export function resolveLanguage(pref: AppLanguage): 'es' | 'en' {
  if (pref === 'es' || pref === 'en') return pref;
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** Aplica la preferencia de idioma (usuario o localStorage) y la persiste en caché. */
export function applyLanguage(pref: AppLanguage): void {
  try {
    window.localStorage.setItem('keynest-lang', pref);
  } catch {
    /* noop */
  }
  void i18n.changeLanguage(resolveLanguage(pref));
}

export function cachedLanguagePref(): AppLanguage {
  try {
    const v = window.localStorage.getItem('keynest-lang');
    if (v === 'es' || v === 'en' || v === 'auto') return v;
  } catch {
    /* noop */
  }
  return 'auto';
}

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: resolveLanguage(cachedLanguagePref()),
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
});

/** Locale Intl actual para formateadores (es-ES | en-US). */
export function intlLocale(): string {
  return i18n.language?.startsWith('en') ? 'en-US' : 'es-ES';
}

export default i18n;
