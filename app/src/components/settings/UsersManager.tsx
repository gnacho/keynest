// Gestión de usuarios (solo admin): lista + alta con rol admin opcional.
// Patrón webapp-shell (assets/UsersManager.tsx) adaptado a Keynest:
// selects shadcn (respetan el tema), api-client propio, salvaguardas en server
// (no auto-borrado, no auto-cambio de rol, protección último admin).
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, Trash2, UserRoundPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import PersonAvatar from '@/components/PersonAvatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, LANGUAGES } from '@/components/settings/settings-cards';
import { api } from '@/lib/api';
import { cachedUser } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  language: string;
  role: 'user' | 'admin' | string;
}

const inputCls =
  'h-10 w-full rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40';

export default function UsersManager() {
  const { t: tr } = useTranslation();
  const meId = cachedUser()?.id ?? '';
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState('auto');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [pwdFor, setPwdFor] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = async () => {
    const d = await api<{ users: AdminUser[] }>('/api/users');
    setUsers(d.users);
  };
  useEffect(() => {
    reload().catch(() => undefined);
  }, []);

  const create = async () => {
    if (busy || !username.trim() || password.length < 6) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password, language, role }),
      });
      setUsername('');
      setPassword('');
      setLanguage('auto');
      setRole('user');
      setShowCreate(false);
      await reload();
      toast.success(tr('aj.usuarioCreadoOk'));
    } catch (err) {
      setError(err instanceof Error && err.message.includes('existe') ? tr('aj.usuarioExiste') : tr('aj.passErrGeneral'));
    } finally {
      setBusy(false);
    }
  };

  const apiErrorToast = (err: unknown) => {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('último') || msg.includes('last-admin')) toast.error(tr('aj.noUltimoAdmin'));
    else toast.error(tr('aj.errorGuardar'));
  };

  const changePassword = async (id: string) => {
    if (newPwd.length < 6) return;
    try {
      await api(`/api/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password: newPwd }) });
      setPwdFor(null);
      setNewPwd('');
      toast.success(tr('aj.passCambiada'));
    } catch (err) {
      apiErrorToast(err);
    }
  };
  const changeRole = async (id: string, r: string) => {
    try {
      await api(`/api/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role: r }) });
      await reload();
    } catch (err) {
      apiErrorToast(err);
      await reload(); // repinta el valor real
    }
  };
  const changeLanguage = async (id: string, l: string) => {
    try {
      await api(`/api/users/${id}/language`, { method: 'PUT', body: JSON.stringify({ language: l }) });
      await reload();
    } catch (err) {
      apiErrorToast(err);
    }
  };
  const remove = async (id: string) => {
    try {
      await api(`/api/users/${id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      setUsers((us) => us.filter((u) => u.id !== id));
      toast.success(tr('aj.usuarioEliminado'));
    } catch (err) {
      apiErrorToast(err);
      setConfirmDelete(null);
    }
  };

  return (
    <Card title={tr('aj.usuarios')} desc={tr('aj.gestionDesc')}>
      <ul className="flex flex-col gap-2">
        {users.map((u) => (
          <li key={u.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <PersonAvatar
                name={u.username}
                initials={u.username.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                size={32}
              />
              {/* Nombre + rol: ocultos en móvil (no caben en la fila, #200) */}
              <div className="hidden min-w-0 flex-1 sm:block">
                <p className="truncate text-sm font-semibold">
                  {u.username}
                  {u.id === meId && (
                    <span className="ml-1.5 text-[11px] font-medium" style={{ color: 'var(--text-faint)' }}>
                      ({tr('aj.tu')})
                    </span>
                  )}
                </p>
                <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {u.role === 'admin' ? tr('aj.rolAdmin') : tr('aj.rolUser')}
                </p>
              </div>
              <Select value={u.language || 'auto'} onValueChange={(v) => void changeLanguage(u.id, v)}>
                <SelectTrigger aria-label={tr('aj.idioma')} className="h-9 w-[130px] rounded-xl border-[var(--border)] bg-[var(--surface)] text-xs shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                  <SelectItem value="auto">🌐 {tr('aj.idiomaAuto')}</SelectItem>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.flag} {l.nativeName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {u.id !== meId && (
                <>
                  <Select value={u.role === 'admin' ? 'admin' : 'user'} onValueChange={(v) => void changeRole(u.id, v)}>
                    <SelectTrigger aria-label={tr('aj.rol')} className="h-9 w-[120px] rounded-xl border-[var(--border)] bg-[var(--surface)] text-xs shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                      <SelectItem value="user">{tr('aj.rolUser')}</SelectItem>
                      <SelectItem value="admin">{tr('aj.rolAdmin')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    aria-label={tr('aj.resetPassword')}
                    onClick={() => {
                      setPwdFor(pwdFor === u.id ? null : u.id);
                      setNewPwd('');
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border transition-colors hover:bg-[var(--surface)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    <KeyRound className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  {confirmDelete === u.id ? (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void remove(u.id)}
                        className="flex h-9 items-center rounded-xl px-3 text-xs font-semibold text-white"
                        style={{ backgroundColor: '#F43F5E' }}
                      >
                        {tr('aj.confirmar')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="flex h-9 items-center rounded-xl border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                      >
                        {tr('aj.cancelar')}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={tr('aj.eliminarUsuario')}
                      onClick={() => setConfirmDelete(u.id)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border transition-colors hover:bg-[var(--ro-chip-bg)]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  )}
                </>
              )}
            </div>
            <AnimatePresence initial={false}>
              {pwdFor === u.id && (
                <motion.form
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-3 flex items-end gap-2 overflow-hidden"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void changePassword(u.id);
                  }}
                >
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={6}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    placeholder={tr('aj.nuevaPassword')}
                    aria-label={tr('aj.nuevaPassword')}
                    className={cn(inputCls, 'h-9 flex-1')}
                    style={{ borderColor: 'var(--border)' }}
                  />
                  <button
                    type="submit"
                    disabled={newPwd.length < 6}
                    className="brand-gradient flex h-9 items-center rounded-xl px-3 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {tr('aj.guardar')}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </li>
        ))}
      </ul>

      {!showCreate ? (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          <UserRoundPlus className="h-4 w-4" strokeWidth={1.75} /> {tr('aj.nuevoUsuario')}
        </button>
      ) : (
        <motion.form
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="flex flex-col gap-4 overflow-hidden border-t pt-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={tr('aj.usuario')}
              aria-label={tr('aj.usuario')}
              className={inputCls}
              style={{ borderColor: 'var(--border)' }}
            />
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tr('aj.password')}
              aria-label={tr('aj.password')}
              className={inputCls}
              style={{ borderColor: 'var(--border)' }}
            />
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger aria-label={tr('aj.idioma')} className="h-10 w-full rounded-xl border-[var(--border)] bg-[var(--surface)] shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                <SelectItem value="auto">🌐 {tr('aj.idiomaAuto')}</SelectItem>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.flag} {l.nativeName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Rol con opción admin en el alta (regla webapp-shell) */}
            <Select value={role} onValueChange={(v) => setRole(v as 'user' | 'admin')}>
              <SelectTrigger aria-label={tr('aj.rol')} className="h-10 w-full rounded-xl border-[var(--border)] bg-[var(--surface)] shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                <SelectItem value="user">{tr('aj.rolUser')}</SelectItem>
                <SelectItem value="admin">{tr('aj.rolAdmin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !username.trim() || password.length < 6}
              className="brand-gradient flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              <UserRoundPlus className="h-4 w-4" strokeWidth={1.75} />
              {tr('aj.crearUsuario')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setError('');
              }}
              className="flex h-10 items-center rounded-xl border px-4 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              {tr('aj.cancelar')}
            </button>
          </div>
        </motion.form>
      )}
    </Card>
  );
}
