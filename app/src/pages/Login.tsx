import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Eye, EyeOff, Lock, Moon, Sparkles, Sun, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/theme-context';
import { demoLogin, demoStatus, login } from '@/lib/auth';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

function LoginForm() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [demoAvailable, setDemoAvailable] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    void demoStatus().then(setDemoAvailable);
  }, []);

  const enterDemo = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await demoLogin();
      window.dispatchEvent(new Event('keynest-authed'));
      navigate('/');
    } catch {
      setError(t('login.demoError'));
      setLoading(false);
    }
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (loading || !username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password, remember);
      window.dispatchEvent(new Event('keynest-authed'));
      navigate('/');
    } catch (err) {
      setError(err instanceof Error && err.message.includes('conectar') ? t('login.errorConexion') : t('login.errorCredenciales'));
      setLoading(false);
    }
  };

  const inputCls =
    'h-12 w-full rounded-xl border bg-[var(--surface)] pl-10 pr-11 text-sm outline-none transition-shadow duration-150 focus:ring-2 focus:ring-[#6366F1]';
  const inputStyle = { borderColor: 'var(--border)', color: 'var(--text)' };

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-4">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">{t('login.bienvenido')}</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('login.subtitulo')}
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {t('login.usuario')}
        </span>
        <span className="relative block">
          <User className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            className={inputCls}
            style={inputStyle}
          />
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {t('login.password')}
        </span>
        <span className="relative block">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className={inputCls}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? t('login.ocultar') : t('login.mostrar')}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: 'var(--text-faint)' }}
          >
            {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        </span>
      </label>

      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded accent-[#6366F1]"
          />
          {t('login.recuerdame')}
        </label>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400">
          {error}
        </p>
      )}

      <motion.button
        type="submit"
        disabled={loading || !username.trim() || !password}
        whileTap={{ scale: 0.98 }}
        className="brand-gradient flex h-12 items-center justify-center rounded-xl text-[15px] font-semibold text-white transition-[filter] duration-150 hover:brightness-[1.08] disabled:opacity-70"
      >
        {loading ? (
          <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : (
          t('login.entrar')
        )}
      </motion.button>

      {demoAvailable && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1" style={{ backgroundColor: 'var(--border)' }} />
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('login.oContinua')}
            </span>
            <span className="h-px flex-1" style={{ backgroundColor: 'var(--border)' }} />
          </div>
          <motion.button
            type="button"
            onClick={enterDemo}
            disabled={loading}
            whileTap={{ scale: 0.98 }}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border text-[15px] font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)] disabled:opacity-70"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <Sparkles className="h-[18px] w-[18px] text-violet-500" />
            {t('login.entrarDemo')}
          </motion.button>
        </>
      )}
    </form>
  );
}

function ThemeFab() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t('nav.temaClaro')}
      className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border shadow-card backdrop-blur-md transition-colors hover:brightness-105"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--surface) 80%, transparent)',
        borderColor: 'var(--border)',
        color: 'var(--text-muted)',
      }}
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

export default function Login() {
  const reduce = useReducedMotion();
  const { t } = useTranslation();

  const claimBlock = (light: boolean) => (
    <>
      <motion.img
        src="/logo-white.svg"
        alt="Keynest"
        className={light ? 'h-9 w-9' : 'h-12 w-12'}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT_QUART, delay: 0.2 }}
      />
      <motion.h1
        className={
          light
            ? 'font-display text-[32px] font-bold leading-tight text-white'
            : 'font-display text-[28px] font-bold leading-tight text-white'
        }
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT_QUART, delay: 0.29 }}
      >
        {t('login.claim')}
      </motion.h1>
      <motion.p
        className="text-[15px] text-white/80"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT_QUART, delay: 0.38 }}
      >
        {t('login.claimSub')}
      </motion.p>
    </>
  );

  return (
    <div className="min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)' }}>
      <ThemeFab />

      {/* ================= Desktop (≥ lg): split 50/50 */}
      <div className="hidden min-h-[100dvh] lg:flex">
        <div className="relative w-1/2 overflow-hidden">
          <motion.img
            src="/login-hero.svg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: EASE_OUT_QUART }}
          />
          {!reduce && (
            <motion.div
              className="absolute inset-0"
              animate={{ scale: [1, 1.06] }}
              transition={{ duration: 20, repeat: Infinity, repeatType: 'mirror', ease: 'linear' }}
              style={{
                backgroundImage: 'url(/login-hero.svg)',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          )}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgb(8 13 26 / 0.25), rgb(99 102 241 / 0.55))' }}
          />
          <div className="absolute bottom-0 left-0 flex flex-col gap-4 p-12">{claimBlock(true)}</div>
        </div>
        <div className="flex w-1/2 items-center justify-center px-8" style={{ backgroundColor: 'var(--bg)' }}>
          <motion.div
            className="flex w-full max-w-[420px] flex-col gap-6"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_OUT_QUART, delay: 0.3 }}
          >
            <div className="flex items-center gap-2.5">
              <img src="/logo.svg" alt="Keynest" className="h-8 w-8" />
              <span className="font-display text-[22px] font-bold tracking-[-0.02em]">Keynest</span>
            </div>
            <LoginForm />
          </motion.div>
        </div>
      </div>

      {/* ================= Móvil (< lg): inmersivo */}
      <div className="relative flex min-h-[100dvh] flex-col lg:hidden">
        <motion.img
          src="/login-hero.svg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: EASE_OUT_QUART }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgb(8 13 26 / 0.4), rgb(8 13 26 / 0.85))' }}
        />
        <div className="relative flex flex-1 flex-col items-center justify-center gap-3 px-8 pt-16 text-center">
          {claimBlock(false)}
        </div>
        <motion.div
          className="relative rounded-t-3xl p-6"
          style={{
            backgroundColor: 'var(--surface)',
            paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
          }}
          initial={reduce ? { opacity: 0 } : { opacity: 1, y: '100%' }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={
            reduce
              ? { duration: 0.15 }
              : { type: 'spring', stiffness: 300, damping: 32, delay: 0.1 }
          }
        >
          <LoginForm />
        </motion.div>
      </div>
    </div>
  );
}
