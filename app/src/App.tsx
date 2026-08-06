import { Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import ThemeProvider from '@/theme/ThemeProvider';
import DataProvider from '@/data/DataProvider';
import AppShell from '@/components/AppShell';
import ErrorBoundary from '@/components/ErrorBoundary';
import { lazyRetry } from '@/lib/lazy-retry';
import { clearSession, isAuthed } from '@/lib/auth';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';

// React.lazy por ruta (code-split desde el día 1) con lazyRetry (anti
// pantalla-negra): si el chunk ya no existe tras un despliegue, recarga 1 vez.
const Calendario = lazyRetry(() => import('@/pages/Calendario'));
const Reservas = lazyRetry(() => import('@/pages/Reservas'));
const Tedee = lazyRetry(() => import('@/pages/Tedee'));
const Limpieza = lazyRetry(() => import('@/pages/Limpieza'));
const Mantenimiento = lazyRetry(() => import('@/pages/Mantenimiento'));
const Rentabilidad = lazyRetry(() => import('@/pages/Rentabilidad'));
const Ajustes = lazyRetry(() => import('@/pages/Ajustes'));
const TokenView = lazyRetry(() => import('@/pages/TokenView'));

/**
 * AuthGate: sin sesión → /login. Un 401 de la API limpia la sesión y redirige.
 * Las rutas /login y /t/:token (personal de limpieza) se renderizan FUERA del AppShell.
 */
function Root() {
  const location = useLocation();
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(() => isAuthed());
  const isLogin = location.pathname === '/login';
  const isTokenView = location.pathname.startsWith('/t/');

  useEffect(() => {
    const onUnauthorized = () => {
      clearSession();
      setAuthed(false);
      navigate('/login', { replace: true });
    };
    const onAuthed = () => setAuthed(true);
    window.addEventListener('keynest-unauthorized', onUnauthorized);
    window.addEventListener('keynest-authed', onAuthed);
    return () => {
      window.removeEventListener('keynest-unauthorized', onUnauthorized);
      window.removeEventListener('keynest-authed', onAuthed);
    };
  }, [navigate]);

  // Acceso por enlace token (limpieza): sin login ni AppShell
  if (isTokenView) {
    return (
      <ErrorBoundary>
        <Suspense fallback={null}>
          <Routes location={location}>
            <Route path="/t/:token" element={<TokenView />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (!authed && !isLogin) return <Navigate to="/login" replace />;
  if (authed && isLogin) return <Navigate to="/" replace />;

  if (isLogin) {
    return (
      <Routes location={location}>
        <Route path="/login" element={<Login />} />
      </Routes>
    );
  }

  return (
    <AppShell>
      <ErrorBoundary>
        <Suspense fallback={null}>
        <Routes location={location}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/calendario" element={<Calendario />} />
          <Route path="/reservas" element={<Reservas />} />
          <Route path="/tedee" element={<Tedee />} />
          <Route path="/limpieza" element={<Limpieza />} />
          <Route path="/mantenimiento" element={<Mantenimiento />} />
          <Route path="/rentabilidad" element={<Rentabilidad />} />
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <DataProvider>
          <Root />
        </DataProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
