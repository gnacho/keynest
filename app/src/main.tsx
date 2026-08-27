import { createRoot } from 'react-dom/client';
import './fonts.css';
import './index.css';
import { applyBootPreferences } from '@/theme/ThemeProvider';
import App from './App.tsx';

// Preferencias (tema/densidad) antes del primer render.
applyBootPreferences();

// Service worker (push): solo producción y solo en contextos seguros
// (HTTPS/localhost). En LAN HTTP navigator.serviceWorker es undefined.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(<App />);
