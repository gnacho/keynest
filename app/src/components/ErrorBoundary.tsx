// ErrorBoundary.tsx — red de seguridad de render (anti pantalla negra).
// Ver webapp-shell references/actualizaciones.md. Envolver el <Suspense> de las
// vistas: cualquier error de render muestra tarjeta con botón "Recargar".
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { withTranslation } from 'react-i18next';
import type { WithTranslation } from 'react-i18next';

interface State {
  hasError: boolean;
}

class ErrorBoundaryInner extends Component<{ children: ReactNode } & WithTranslation, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    console.error('[keynest] render error:', err, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const { t } = this.props;
    return (
      <div className="grid min-h-[50vh] place-items-center px-4" role="alert">
        <div
          className="max-w-md rounded-2xl border p-8 text-center"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--surface)',
            boxShadow: 'var(--overlay-shadow)',
          }}
        >
          <h3 className="font-display text-[17px] font-semibold" style={{ color: 'var(--text)' }}>
            {t('errorBoundary.title')}
          </h3>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('errorBoundary.desc')}
          </p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-5 flex h-11 w-full items-center justify-center rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#6366F1' }}
          >
            {t('errorBoundary.reload')}
          </button>
        </div>
      </div>
    );
  }
}

const ErrorBoundary = withTranslation()(ErrorBoundaryInner);
export default ErrorBoundary;
