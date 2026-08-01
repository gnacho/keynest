import { createRoot } from 'react-dom/client';
import './index.css';
import { applyBootPreferences } from '@/theme/ThemeProvider';
import App from './App.tsx';

// Preferencias (tema/densidad/reduce-motion) antes del primer render.
applyBootPreferences();

createRoot(document.getElementById('root')!).render(<App />);
