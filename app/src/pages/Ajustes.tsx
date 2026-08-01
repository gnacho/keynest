import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import {
  Ban,
  BedDouble,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  Copy,
  DoorOpen,
  Euro,
  Info,
  KeyRound,
  Link2,
  LogOut,
  MapPin,
  MonitorSmartphone,
  Moon,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Ruler,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  UserRoundPlus,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import PersonAvatar from '@/components/PersonAvatar';
import { Toaster } from '@/components/ui/sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { useTranslation } from 'react-i18next';
import { EXPENSE_META, EXPENSE_TYPES, TYPE_SWATCHES } from '@/components/fin/expenseMeta';
import { useData } from '@/data/useData';
import { useTheme } from '@/theme/ThemeProvider';
import { logout, saveLanguage, cachedUser, demoStatus, setDemoMode } from '@/lib/auth';
import { api } from '@/lib/api';
import { applyLanguage, cachedLanguagePref } from '@/i18n';
import { copyText } from '@/lib/clipboard';
import { catIcon, CAT_ICONS } from '@/lib/cat-icons';
import type { MaintCategory } from '@/data/types';
import type { AppLanguage } from '@/i18n';
import type { AppUser, ExpenseType, Person, PersonRole } from '@/data/types';
import { fmtDateShort, fmtMoney, fmtRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

const containerV: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const itemV: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT_QUART } },
};

type TabId = 'inmuebles' | 'personas' | 'usuarios' | 'gasto' | 'categorias' | 'preferencias';

const TABS: { id: TabId; labelKey: string; icon: LucideIcon }[] = [
  { id: 'inmuebles', labelKey: 'aj.inmuebles', icon: Building2 },
  { id: 'personas', labelKey: 'aj.personas', icon: Users },
  { id: 'usuarios', labelKey: 'aj.usuarios', icon: KeyRound },
  { id: 'gasto', labelKey: 'aj.tiposGasto', icon: Wallet },
  { id: 'categorias', labelKey: 'aj.categorias', icon: Wrench },
  { id: 'preferencias', labelKey: 'aj.preferencias', icon: Settings2 },
];

const PROP_ACTIONS = [
  { to: '/calendario', labelKey: 'nav.calendario', icon: CalendarDays, color: '#3B82F6' },
  { to: '/reservas', labelKey: 'nav.reservas', icon: BookOpen, color: '#10B981' },
  { to: '/limpieza', labelKey: 'nav.limpieza', icon: Sparkles, color: '#8B5CF6' },
  { to: '/rentabilidad', labelKey: 'nav.rentabilidad', icon: TrendingUp, color: '#6366F1' },
] as const;

/* ===================================================== Tipos locales de maestros */
interface PropertyOverride {
  name: string;
  address: string;
  bedrooms: number;
  bathrooms: number;
  area: number;
  icalUrl: string;
}

interface ExpenseTypeConfig {
  key: string;
  name: string;
  color: string;
  recurrent: boolean;
  fixedAmount: number;
  scope: 'inmueble' | 'global';
  baseType?: ExpenseType; // si es uno de los 5 del modelo
}

const inputCls =
  'h-10 rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40';
const inputStyle = { borderColor: 'var(--border)' };

/* ================================================================== Página */
export default function Ajustes() {
  const { t: tr } = useTranslation();
  const data = useData();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { mode: themeModeRaw, setMode } = useTheme();

  const [tab, setTab] = useState<TabId>('inmuebles');

  /* ---- Inmuebles: edición real contra el backend ---- */
  const properties = data.getProperties();
  const syncStatus = data.getSyncStatus();
  const [syncing, setSyncing] = useState(false);
  const [editProp, setEditProp] = useState<string | 'new' | null>(null);
  const [icalCheck, setIcalCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; count?: number; code?: string; status?: number }>({ state: 'idle' });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoPick = async (file: File | undefined) => {
    if (!file || !editProp || editProp === 'new') return;
    setUploadingPhoto(true);
    try {
      await data.uploadPropertyPhoto(editProp, file);
      toast.success(tr('aj.fotoOk'));
    } catch {
      toast.error(tr('aj.fotoError'));
    } finally {
      setUploadingPhoto(false);
    }
  };
  const [propForm, setPropForm] = useState<PropertyOverride>({ name: '', address: '', bedrooms: 1, bathrooms: 1, area: 0, icalUrl: '' });
  const [flashProp, setFlashProp] = useState<string | null>(null);

  /* ---- Personas: BD real vía provider ---- */
  const people = data.getPeople();
  const [personLinks, setPersonLinks] = useState<Record<string, string>>({});
  const [copiedPerson, setCopiedPerson] = useState<string | null>(null);
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const [personForm, setPersonForm] = useState({ name: '', phone: '', hourlyRate: 0, specialty: '' });
  const [deletePerson, setDeletePerson] = useState<Person | null>(null);
  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [newPersonRole, setNewPersonRole] = useState<PersonRole>('limpieza');

  /* ---- Usuarios (provider): copia de enlaces + alta ---- */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [userForm, setUserForm] = useState({ name: '', phone: '' });
  const [checklistText, setChecklistText] = useState('');
  const [instructionsText, setInstructionsText] = useState('');

  /* ---- Categorías de mantenimiento: maestro en BD ---- */
  const [cats, setCats] = useState<MaintCategory[]>(() => data.getCategories().map((c) => ({ ...c })));
  useEffect(() => {
    setCats(data.getCategories().map((c) => ({ ...c })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.version]);
  const updateCat = (key: string, patch: Partial<MaintCategory>) =>
    setCats((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const removeCat = (key: string) => setCats((prev) => prev.filter((c) => c.key !== key));
  const addCat = () => {
    const base = `cat-${Date.now().toString(36)}`;
    setCats((prev) => [...prev, { key: base, label: '', icon: 'wrench' }]);
  };
  const saveCats = async () => {
    const clean = cats.filter((c) => c.label.trim());
    await data.saveCategories(clean);
    toast.success(tr('aj.categoriaGuardada'));
  };

  /* ---- Tipos de gasto: configuración local ---- */
  const [typeConfigs, setTypeConfigs] = useState<ExpenseTypeConfig[]>(() =>
    EXPENSE_TYPES.map((t) => ({
      key: t,
      name: EXPENSE_META[t].label,
      color: EXPENSE_META[t].color,
      recurrent: t === 'internet',
      fixedAmount: t === 'internet' ? 39.99 : 0,
      scope: 'inmueble',
      baseType: t,
    })),
  );
  const [newTypeOpen, setNewTypeOpen] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeColor, setNewTypeColor] = useState(TYPE_SWATCHES[5]);
  const [newTypeRecurrent, setNewTypeRecurrent] = useState(false);

  /* ---- Preferencias ---- */
  const themeMode: 'claro' | 'oscuro' | 'auto' = themeModeRaw === 'system' ? 'auto' : themeModeRaw === 'dark' ? 'oscuro' : 'claro';
  const [lang, setLang] = useState<AppLanguage>(() => cachedUser()?.language ?? cachedLanguagePref());
  const [demoOn, setDemoOn] = useState(true);
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string | null; available: boolean } | null>(null);
  const [applying, setApplying] = useState(false);
  const isAdmin = cachedUser()?.role === 'admin';

  const checkUpdate = async () => {
    try {
      setUpdateInfo(await api('/api/update/status'));
    } catch { /* noop */ }
  };

  const applyUpdate = async () => {
    if (applying) return;
    setApplying(true);
    try {
      await api('/api/update/apply', { method: 'POST' });
      toast.success(tr('aj.actualizadoOk'));
      setUpdateInfo(null);
    } catch {
      toast.error(tr('aj.errorActualizar'));
    } finally {
      setApplying(false);
    }
  };

  const [tedeeUrl, setTedeeUrl] = useState('');
  const [tedeeToken, setTedeeToken] = useState('');
  const [tedeeState, setTedeeState] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; text?: string }>({ state: 'idle' });
  interface ApiUser { id: string; username: string; email: string | null; phone: string | null; language: string; role: string }
  const [realUsers, setRealUsers] = useState<ApiUser[]>([]);
  useEffect(() => {
    void demoStatus().then(setDemoOn);
    void checkUpdate();
    void api<{ url: string }>('/api/config/tedee')
      .then((d) => { if (d?.url) setTedeeUrl(d.url); })
      .catch(() => undefined);
    void api<{ users: ApiUser[] }>('/api/users')
      .then((d) => { if (d?.users) setRealUsers(d.users); })
      .catch(() => undefined);
  }, []);

  const saveTedee = async () => {
    setTedeeState({ state: 'checking' });
    try {
        await api('/api/config/tedee', {
        method: 'PUT',
        body: JSON.stringify({ url: tedeeUrl.trim(), token: tedeeToken.trim() }),
      });
      const test = await api<{ ok: boolean; locks?: { name: string }[]; code?: string }>('/api/tedee/test');
      if (test.ok) {
        setTedeeState({ state: 'ok', text: tr('aj.tedeeOk', { count: (test.locks ?? []).length, names: (test.locks ?? []).map((l: { name: string }) => l.name).join(', ') }) });
        toast.success(tr('aj.tedeeGuardado'));
      } else if (test.code === 'not-configured') {
        setTedeeState({ state: 'error', text: tr('aj.tedeeErrConfig') });
      } else if (typeof test.code === 'string' && test.code.startsWith('http-')) {
        setTedeeState({ state: 'error', text: tr('aj.tedeeErrHttp', { status: test.code.slice(5) }) });
      } else {
        setTedeeState({ state: 'error', text: tr('aj.tedeeErrFetch') });
      }
    } catch {
      setTedeeState({ state: 'error', text: tr('aj.tedeeErrFetch') });
    }
  };
  const toggleDemo = (v: boolean) => {
    setDemoOn(v);
    void setDemoMode(v).catch(() => setDemoOn(!v));
  };
  const changeLang = (v: AppLanguage) => {
    setLang(v);
    applyLanguage(v);
    void saveLanguage(v).catch(() => undefined);
  };
  const [checkInTime, setCheckInTime] = useState(() => data.getSettings().checkInTime);
  const [checkOutTime, setCheckOutTime] = useState(() => data.getSettings().checkOutTime);
  const [autoCleaning, setAutoCleaning] = useState(() => data.getSettings().autoCleaning);
  const [batteryThreshold, setBatteryThreshold] = useState(() => [data.getSettings().batteryThreshold]);
  const [lookaheadDays, setLookaheadDays] = useState(() => data.getSettings().lookaheadDays);
  const savePref = (patch: Parameters<typeof data.saveSettings>[0]) => {
    void data.saveSettings(patch).catch(() => toast.error(tr('aj.errorGuardar')));
  };
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [marginDays, setMarginDays] = useState(() => data.getCleaningMarginDays());
  useEffect(() => {
    setMarginDays(data.getCleaningMarginDays());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.version]);
  const saveMargin = async () => {
    await data.saveCleaningMarginDays(marginDays);
    toast.success(tr('aj.guardar'));
  };
  const [passOpen, setPassOpen] = useState(false);
  const [passForm, setPassForm] = useState({ current: '', next: '', repeat: '' });
  const [passError, setPassError] = useState('');
  const [passBusy, setPassBusy] = useState(false);

  const changePassword = async () => {
    setPassError('');
    if (passForm.next.length < 6) { setPassError(tr('aj.passErrCorta')); return; }
    if (passForm.next !== passForm.repeat) { setPassError(tr('aj.passErrCoincide')); return; }
    setPassBusy(true);
    try {
      try {
        await api('/api/auth/password', {
          method: 'PUT',
          body: JSON.stringify({ current: passForm.current, next: passForm.next }),
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes('403')) { setPassError(tr('aj.passErrActual')); return; }
        throw err;
      }
      setPassOpen(false);
      setPassForm({ current: '', next: '', repeat: '' });
      toast.success(tr('aj.passCambiada'));
    } catch {
      setPassError(tr('aj.passErrGeneral'));
    } finally {
      setPassBusy(false);
    }
  };

  const [newUserPass, setNewUserPass] = useState('');
  const [newUserError, setNewUserError] = useState('');
  const createGestionUser = async () => {
    setNewUserError('');
    if (!userForm.name.trim()) return;
    if (newUserPass.length < 6) { setNewUserError(tr('aj.passwordReq')); return; }
    let d: { user: ApiUser };
    try {
      d = await api<{ user: ApiUser }>('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username: userForm.name.trim(), password: newUserPass, phone: userForm.phone }),
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('existe')) { setNewUserError(tr('aj.usuarioExiste')); return; }
      setNewUserError(tr('aj.passErrGeneral'));
      return;
    }
    setRealUsers((prev) => [...prev, d.user]);
    setNewUserOpen(false);
    setNewUserPass('');
    setUserForm({ name: '', phone: '' });
    toast.success(tr('aj.usuarioCreadoOk'));
  };

  const expenses = data.getExpenses();

  const expenseCountByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) map.set(e.type, (map.get(e.type) ?? 0) + 1);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.version]);

  const activeTasksFor = (p: Person): number => {
    if (p.role === 'limpieza') {
      return data.getCleanings().filter((c) => c.assigneeIds.includes(p.id) && c.status !== 'archivada').length;
    }
    return data.getMaintenance().filter((t) => t.assigneeId === p.id && t.status !== 'finalizada').length;
  };

  /* -------------------------------------------------------- handlers inmuebles */
  const openEditProp = (id: string) => {
    const p = properties.find((x) => x.id === id)!;
    setPropForm({
      name: p.name,
      address: p.address,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      area: p.area,
      icalUrl: p.icalUrl ?? '',
    });
    setChecklistText(p.checklist.join('\n'));
    setInstructionsText(p.instructions);
    setIcalCheck({ state: 'idle' });
    setEditProp(id);
  };

  const openNewProp = () => {
    setPropForm({ name: '', address: '', bedrooms: 1, bathrooms: 1, area: 0, icalUrl: '' });
    setChecklistText('');
    setInstructionsText('');
    setIcalCheck({ state: 'idle' });
    setEditProp('new');
  };

  const verifyIcal = async (url: string): Promise<boolean> => {
    setIcalCheck({ state: 'checking' });
    try {
      const res = await fetch('/api/ical/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { ok: boolean; count?: number; code?: string; status?: number };
      if (data.ok) {
        setIcalCheck({ state: 'ok', count: data.count });
        return true;
      }
      setIcalCheck({ state: 'error', code: data.code, status: data.status });
      return false;
    } catch {
      setIcalCheck({ state: 'error', code: 'fetch' });
      return false;
    }
  };

  const icalErrorText = (): string => {
    if (icalCheck.state !== 'error') return '';
    switch (icalCheck.code) {
      case 'url': return tr('aj.icalErrUrl');
      case 'http': return tr('aj.icalErrHttp', { status: icalCheck.status ?? '' });
      case 'not-ics': return tr('aj.icalErrNotIcs');
      case 'empty': return tr('aj.icalErrEmpty');
      default: return tr('aj.icalErrFetch');
    }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await data.syncNow();
      toast.success(tr('aj.syncOk'));
    } catch {
      toast.error(tr('aj.syncError'));
    } finally {
      setSyncing(false);
    }
  };

  const saveProp = async () => {
    if (!editProp) return;
    const items = checklistText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const input = {
      name: propForm.name.trim(),
      address: propForm.address.trim(),
      bedrooms: propForm.bedrooms,
      bathrooms: propForm.bathrooms,
      area: propForm.area,
      photo: editProp === 'new' ? '/prop-carmen.svg' : (properties.find((x) => x.id === editProp)?.photo ?? '/prop-carmen.svg'),
      icalUrl: propForm.icalUrl.trim(),
      checklist: items,
      instructions: instructionsText.trim(),
    };
    if (!input.name) return;
    if (input.icalUrl) {
      const ok = await verifyIcal(input.icalUrl);
      if (!ok) return; // aviso inline: corrige la URL o déjala vacía
    }
    try {
      const saved = editProp === 'new' ? await data.addProperty(input) : await data.saveProperty(editProp, input);
      setEditProp(null);
      toast.success(editProp === 'new' ? tr('aj.inmuebleCreado') : tr('aj.inmuebleActualizado'));
      if (saved) {
        setFlashProp(saved.id);
        setTimeout(() => setFlashProp(null), 1300);
      }
      // Si tiene iCal, sincroniza en segundo plano
      if (input.icalUrl) void data.syncNow();
    } catch {
      toast.error(tr('aj.errorGuardar'));
    }
  };

  /* -------------------------------------------------------- handlers personas */
  const openEditPerson = (p: Person) => {
    setPersonForm({ name: p.name, phone: p.phone, hourlyRate: p.hourlyRate, specialty: p.specialty });
    setEditPerson(p);
  };

  const savePerson = async () => {
    if (!editPerson) return;
    await data.savePerson(editPerson.id, {
      name: personForm.name.trim(),
      phone: personForm.phone,
      role: editPerson.role,
      specialty: personForm.specialty,
      hourlyRate: personForm.hourlyRate || 10,
    });
    setEditPerson(null);
    toast.success(tr('aj.personaActualizada'));
  };

  const addPerson = async () => {
    if (!personForm.name.trim()) {
      toast.error(tr('aj.nombreObligatorio'));
      return;
    }
    await data.addPerson({
      name: personForm.name.trim(),
      role: newPersonRole,
      specialty: personForm.specialty,
      hourlyRate: personForm.hourlyRate || 10,
      phone: personForm.phone,
    });
    setAddPersonOpen(false);
    setPersonForm({ name: '', phone: '', hourlyRate: 10, specialty: '' });
    toast.success(tr('aj.personaAnadida'));
  };

  const genPersonLink = async (p: Person) => {
    const path = await data.generatePersonToken(p.id);
    if (path) {
      const url = `${window.location.origin}${path}`;
      setPersonLinks((prev) => ({ ...prev, [p.id]: url }));
      const ok = await copyText(url);
      toast.success(ok ? tr('aj.enlaceCopiado') : tr('aj.enlaceGenerado2'));
    }
  };

  const copyPersonLink = async (p: Person) => {
    const url = personLinks[p.id];
    if (!url) return;
    const ok = await copyText(url);
    if (ok) {
      setCopiedPerson(p.id);
      setTimeout(() => setCopiedPerson(null), 1500);
      toast.success(tr('aj.enlaceCopiado'));
    }
  };

  const revokePersonLink = async (p: Person) => {
    await data.revokePersonToken(p.id);
    setPersonLinks((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    toast.success(tr('aj.enlaceRevocado'));
  };

  /* -------------------------------------------------------- handlers usuarios */
  const userLink = (u: AppUser) => `https://keynest.app/t/${u.token}`;

  const copyUserLink = (u: AppUser) => {
    if (!u.token) return;
    const link = userLink(u);
    void navigator.clipboard?.writeText(link).catch(() => undefined);
    setCopiedId(u.id);
    setTimeout(() => setCopiedId((id) => (id === u.id ? null : id)), 1500);
  };

  const closeNewUser = (o: boolean) => {
    setNewUserOpen(o);
    if (!o) {
      setUserForm({ name: '', phone: '' });
      setNewUserPass('');
      setNewUserError('');
    }
  };

  /* ----------------------------------------------------- handlers tipos gasto */
  const updateTypeConfig = (key: string, patch: Partial<ExpenseTypeConfig>) => {
    setTypeConfigs((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  };

  const addType = () => {
    if (!newTypeName.trim()) {
      toast.error('Ponle un nombre al tipo');
      return;
    }
    setTypeConfigs((prev) => [
      ...prev,
      {
        key: `custom-${Date.now()}`,
        name: newTypeName.trim(),
        color: newTypeColor,
        recurrent: newTypeRecurrent,
        fixedAmount: 0,
        scope: 'global',
      },
    ]);
    setNewTypeOpen(false);
    setNewTypeName('');
    setNewTypeRecurrent(false);
    toast.success('Tipo de gasto creado');
  };

  /* ----------------------------------------------------------- handlers tema */
  const applyThemeMode = (mode: 'claro' | 'oscuro' | 'auto') => {
    setMode(mode === 'claro' ? 'light' : mode === 'oscuro' ? 'dark' : 'system');
  };

  const editProperty = editProp ? properties.find((p) => p.id === editProp) : undefined;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6 xl:max-w-4xl 2xl:max-w-5xl">
      <Toaster position="top-center" />

      {/* ============================== Topbar */}
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] lg:text-[28px]">Ajustes</h1>
        <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Maestros de la aplicación
        </p>
      </div>

      {/* ============================== Tabs con pill layoutId */}
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <div
          className="inline-flex items-center gap-1 rounded-xl border p-1"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors duration-150',
                  active ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="ajustes-tab-pill"
                    transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 500, damping: 40 }}
                    className="brand-gradient absolute inset-0 rounded-lg"
                  />
                )}
                <t.icon className="relative h-4 w-4" />
                <span className="relative">{tr(t.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.25, ease: EASE_OUT_QUART }}
        >
          {/* ==================================================== TAB INMUEBLES */}
          {tab === 'inmuebles' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleSync()}
                  disabled={syncing}
                  className="flex h-10 items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)] disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                >
                  <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
                  {syncing ? tr('aj.sincronizando') : tr('aj.sincronizar')}
                </button>
                <button
                  type="button"
                  onClick={openNewProp}
                  className="brand-gradient flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
                >
                  <Plus className="h-4 w-4" />
                  {tr('aj.nuevoInmueble')}
                </button>
              </div>
            <motion.div variants={containerV} initial="hidden" animate="show" className="grid gap-4 lg:grid-cols-2">
              {properties.map((p) => {
                const name = p.name;
                const address = p.address;
                const bedrooms = p.bedrooms;
                const area = p.area;
                const bathrooms = p.bathrooms;
                const occ = data.getOccupancy(p.id, new Date());
                return (
                  <motion.article
                    key={p.id}
                    variants={itemV}
                    className={cn('card group overflow-hidden transition-shadow duration-200', flashProp === p.id && 'ring-2 ring-[#6366F1]')}
                  >
                    <div className="relative h-[120px] overflow-hidden">
                      <img src={p.photo} alt={name} loading="lazy" className="h-full w-full object-cover" />
                      <div
                        className="absolute inset-0"
                        style={{ background: 'linear-gradient(180deg, transparent 30%, rgb(0 0 0 / 0.45) 100%)' }}
                      />
                      <span
                        className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md"
                        style={
                          occ.occupied
                            ? { backgroundColor: 'rgb(59 130 246 / 0.9)', color: '#fff' }
                            : { backgroundColor: 'rgb(15 23 42 / 0.55)', color: '#E2E8F0' }
                        }
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', occ.occupied ? 'bg-white' : 'bg-slate-300')} />
                        {occ.occupied ? tr('aj.ocupado') : occ.freeSince ? tr('aj.libreDesde', { date: fmtDateShort(occ.freeSince) }) : tr('aj.libre')}
                      </span>
                      <button
                        type="button"
                        aria-label={tr('aj.editar', { name })}
                        onClick={() => openEditProp(p.id)}
                        className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-md transition-transform duration-200 hover:rotate-90"
                        style={{
                          backgroundColor: 'color-mix(in srgb, var(--surface) 90%, transparent)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <Settings2 className="h-4 w-4" />
                      </button>
                      <div className="absolute bottom-2.5 left-3 right-3">
                        <p className="font-display text-[17px] font-semibold leading-5 text-white">{name}</p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2.5 p-4">
                      <p className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        {address}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                          <BedDouble className="h-3.5 w-3.5" />
                          {bedrooms} {tr('aj.dorm')}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                          <Ruler className="h-3.5 w-3.5" />
                          {area} m²
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                          <DoorOpen className="h-3.5 w-3.5" />{tr('aj.banos', { count: bathrooms })}
                        </span>
                      </div>
                      {p.icalUrl ? (
                        <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', syncStatus[p.id]?.ok === false ? 'bg-rose-500' : 'bg-emerald-500')} />
                          {syncStatus[p.id]?.ok === false
                            ? tr('aj.icalError', { error: syncStatus[p.id]?.error ?? '' })
                            : syncStatus[p.id]?.at
                              ? tr('aj.icalOk', { count: syncStatus[p.id].count ?? 0, time: fmtRelative(new Date(syncStatus[p.id].at)) })
                              : tr('aj.icalPendiente')}
                        </p>
                      ) : (
                        <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-faint)' }}>
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                          {tr('aj.sinIcal')}
                        </p>
                      )}
                      <div className="grid grid-cols-4 gap-1 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                        {PROP_ACTIONS.map(({ to, labelKey, icon: Icon, color }) => (
                          <Link
                            key={to}
                            to={`${to}?inmueble=${p.slug}`}
                            className="flex flex-col items-center gap-1 rounded-xl py-2 transition-colors duration-150 hover:bg-[var(--surface-2)]"
                          >
                            <Icon className="h-[18px] w-[18px]" style={{ color }} strokeWidth={2} />
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                              {tr(labelKey)}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </motion.div>
            </div>
          )}

          {/* ===================================================== TAB PERSONAS */}
          {tab === 'personas' && (
            <div className="flex flex-col gap-6">
              {(['limpieza', 'mantenimiento'] as PersonRole[]).map((role) => {
                const group = people.filter((p) => p.role === role);
                const tone = role === 'limpieza' ? 'violet' : 'rose';
                const chipBg = role === 'limpieza' ? 'var(--vi-chip-bg)' : 'var(--ro-chip-bg)';
                const chipText = role === 'limpieza' ? 'var(--vi-chip-text)' : 'var(--ro-chip-text)';
                const chipDot = role === 'limpieza' ? '#8B5CF6' : '#F43F5E';
                return (
                  <section key={role}>
                    <p
                      className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
                      style={{ color: chipDot }}
                    >
                      {role === 'limpieza' ? tr('aj.limpieza') : tr('aj.mantenimiento')}
                    </p>
                    <motion.div variants={containerV} initial="hidden" animate="show" className="grid gap-3 sm:grid-cols-2">
                      {group.map((p) => {
                        const active = activeTasksFor(p);
                        return (
                          <motion.div
                            key={p.id}
                            variants={itemV}
                            whileHover={reduce ? undefined : { y: -2 }}
                            className="card flex flex-col gap-3 p-4"
                          >
                            <div className="flex items-start gap-3">
                              <PersonAvatar name={p.name} initials={p.initials} size={48} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[15px] font-semibold">{p.name}</p>
                                <p className="truncate text-[13px]" style={{ color: 'var(--text-muted)' }}>
                                  {p.specialty}
                                </p>
                              </div>
                              <button
                                type="button"
                                aria-label={tr('aj.editarA', { name: p.name })}
                                onClick={() => openEditPerson(p)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-2)]"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                aria-label={tr('aj.eliminarA', { name: p.name })}
                                onClick={() => setDeletePerson(p)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--ro-chip-bg)]"
                                style={{ color: '#F43F5E' }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
                              <a
                                href={`tel:${p.phone.replace(/\s/g, '')}`}
                                className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-[#6366F1]"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                <Phone className="h-3.5 w-3.5" />
                                {p.phone}
                              </a>
                              <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                                <Euro className="h-3.5 w-3.5" />
                                <span className="font-display tnum text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
                                  {fmtMoney(p.hourlyRate).replace(' €', '')}
                                  <span style={{ fontSize: '0.6em', color: 'var(--text-faint)', fontWeight: 500, marginLeft: 2 }}>
                                    €/h
                                  </span>
                                </span>
                              </span>
                              <span
                                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                                style={{ backgroundColor: chipBg, color: chipText }}
                                data-tone={tone}
                              >
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: chipDot }} />
                                {tr('aj.activa', { count: active })}
                              </span>
                            </div>
                            {/* Enlace de acceso por token (personal sin cuenta) */}
                            <div className="flex flex-col gap-2 border-t pt-2.5" style={{ borderColor: 'var(--border)' }}>
                              {p.hasToken && !personLinks[p.id] ? (
                                <div className="flex items-center gap-2">
                                  <span className="flex flex-1 items-center gap-1.5 text-[11px] font-medium text-emerald-500">
                                    <Check className="h-3.5 w-3.5" />
                                    {tr('aj.enlaceActivo')}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void genPersonLink(p)}
                                    className="rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-[var(--surface-2)]"
                                    style={{ color: 'var(--text-muted)' }}
                                  >
                                    {tr('aj.regenerar')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void revokePersonLink(p)}
                                    className="rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 transition-colors hover:bg-[var(--ro-chip-bg)]"
                                  >
                                    {tr('aj.revocar')}
                                  </button>
                                </div>
                              ) : personLinks[p.id] ? (
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
                                    <Link2 className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                                    <span className="tnum min-w-0 flex-1 truncate text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                      {personLinks[p.id]}
                                    </span>
                                  </div>
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => void copyPersonLink(p)}
                                      className="flex h-7 flex-1 items-center justify-center gap-1 rounded-lg bg-violet-500 text-[11px] font-semibold text-white transition-all hover:brightness-110"
                                    >
                                      {copiedPerson === p.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                      {copiedPerson === p.id ? tr('aj.copiado') : tr('aj.copiarEnlace')}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void revokePersonLink(p)}
                                      className="flex h-7 items-center rounded-lg border px-2 text-[11px] font-semibold text-rose-500 transition-colors hover:bg-[var(--ro-chip-bg)]"
                                      style={{ borderColor: 'var(--border)' }}
                                    >
                                      {tr('aj.revocar')}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void genPersonLink(p)}
                                  className="flex h-8 items-center justify-center gap-1.5 rounded-xl border border-dashed border-violet-400 text-[11px] font-semibold text-violet-500 transition-colors hover:bg-[var(--vi-chip-bg)]"
                                >
                                  <Link2 className="h-3.5 w-3.5" />
                                  {tr('aj.activarEnlace')}
                                </button>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                      {/* Tarjeta fantasma añadir */}
                      <motion.button
                        variants={itemV}
                        type="button"
                        onClick={() => {
                          setNewPersonRole(role);
                          setPersonForm({ name: '', phone: '', hourlyRate: 10, specialty: '' });
                          setAddPersonOpen(true);
                        }}
                        className="flex min-h-[104px] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed p-4 transition-colors duration-150 hover:bg-[var(--surface-2)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
                      >
                        <UserRoundPlus className="h-6 w-6" strokeWidth={1.8} />
                        <span className="text-sm font-semibold">{tr('aj.anadirPersona')}</span>
                      </motion.button>
                    </motion.div>
                  </section>
                );
              })}
            </div>
          )}

          {/* ===================================================== TAB USUARIOS */}
          {tab === 'usuarios' && (
            <div className="flex flex-col gap-6">
              {(['gestion'] as AppUser['role'][]).map((role) => {
                const group = role === 'gestion'
                  ? realUsers.map((u) => ({ id: u.id, name: u.username, phone: u.phone ?? undefined, role: 'gestion' as const, token: undefined, personId: undefined }))
                  : data.getUsers().filter((u) => u.role === role);
                return (
                  <section key={role}>
                    <p
                      className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
                      style={{ color: role === 'gestion' ? '#6366F1' : '#8B5CF6' }}
                    >
                      {role === 'gestion' ? tr('aj.gestion') : tr('aj.limpieza')}
                    </p>

                    {role === 'gestion' && (
                      <p className="mb-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                        {tr('aj.gestionDesc')}
                      </p>
                    )}
                    {role === 'limpieza' && (
                      <div
                        className="mb-3 flex items-start gap-2.5 rounded-2xl border px-4 py-3"
                        style={{ backgroundColor: 'var(--vi-chip-bg)', borderColor: 'rgb(139 92 246 / 0.3)' }}
                      >
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                        <p className="text-sm" style={{ color: 'var(--vi-chip-text)' }}>
                          {tr('aj.limpiezaInfo')}
                        </p>
                      </div>
                    )}

                    <motion.div variants={containerV} initial="hidden" animate="show" className="grid gap-3 sm:grid-cols-2">
                      {group.map((u) => {
                        const linked = u.personId ? data.getPerson(u.personId) : undefined;
                        return (
                          <motion.div key={u.id} variants={itemV} className="card flex flex-col gap-3 p-4">
                            <div className="flex items-start gap-3">
                              <PersonAvatar
                                name={u.name}
                                initials={u.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                                size={44}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[15px] font-semibold">{u.name}</p>
                                <p className="truncate text-[13px]" style={{ color: 'var(--text-muted)' }}>
                                  {role === 'gestion'
                                    ? tr('aj.propietariaAcceso')
                                    : linked
                                      ? `${linked.specialty} · ${linked.hourlyRate} €/h`
                                      : tr('aj.equipoLimpieza')}
                                </p>
                                {u.phone && (
                                  <a
                                    href={`tel:${u.phone.replace(/\s/g, '')}`}
                                    className="mt-0.5 inline-flex items-center gap-1 text-xs"
                                    style={{ color: 'var(--text-muted)' }}
                                  >
                                    <Phone className="h-3 w-3" />
                                    {u.phone}
                                  </a>
                                )}
                              </div>
                              <span
                                className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                                style={role === 'gestion'
                                  ? { backgroundColor: 'rgb(99 102 241 / 0.12)', color: '#6366F1' }
                                  : { backgroundColor: 'var(--vi-chip-bg)', color: 'var(--vi-chip-text)' }}
                              >
                                {role === 'gestion' ? <ShieldCheck className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                                {role === 'gestion' ? tr('aj.gestion') : tr('aj.limpieza')}
                              </span>
                            </div>

                            {role === 'limpieza' && (
                              <>
                                {u.token ? (
                                    <div
                                      className="flex items-center gap-2 rounded-xl border px-3 py-2"
                                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}
                                    >
                                      <Link2 className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                                      <span className="tnum min-w-0 flex-1 truncate text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                                        {userLink(u)}
                                      </span>
                                    </div>
                                ) : (
                                  <div
                                    className="flex items-center gap-2 rounded-xl border px-3 py-2"
                                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}
                                  >
                                    <Ban className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} />
                                    <span className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>
                                      {tr('aj.accesoRevocado')}
                                    </span>
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={!u.token}
                                    onClick={() => copyUserLink(u)}
                                    className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-500 px-3 text-[13px] font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    {copiedId === u.id ? (
                                      <>
                                        <Check className="h-4 w-4" />
                                        {tr('aj.copiado')}
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="h-4 w-4" />
                                        {tr('aj.copiarEnlace')}
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      data.regenerateUserToken(u.id);
                                      toast.success(tr('aj.enlaceGenerado', { name: u.name }));
                                    }}
                                    className="flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
                                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    {tr('aj.regenerar')}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!u.token}
                                    onClick={() => {
                                      data.revokeUserToken(u.id);
                                      toast.success(tr('aj.accesoRevocadoToast', { name: u.name }));
                                    }}
                                    className="flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition-colors duration-150 hover:bg-[var(--ro-chip-bg)] disabled:cursor-not-allowed disabled:opacity-40"
                                    style={{ borderColor: 'var(--border)', color: '#F43F5E' }}
                                  >
                                    <Ban className="h-3.5 w-3.5" />
                                    {tr('aj.revocar')}
                                  </button>
                                </div>
                              </>
                            )}
                          </motion.div>
                        );
                      })}

                      {/* Tarjeta fantasma añadir usuario */}
                      <motion.button
                        variants={itemV}
                        type="button"
                        onClick={() => {
                          setUserForm({ name: '', phone: '' });
                                              setNewUserOpen(true);
                        }}
                        className="flex min-h-[104px] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed p-4 transition-colors duration-150 hover:bg-[var(--surface-2)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
                      >
                        <UserRoundPlus className="h-6 w-6" strokeWidth={1.8} />
                        <span className="text-sm font-semibold">{tr('aj.nuevoUsuario')}</span>
                      </motion.button>
                    </motion.div>
                  </section>
                );
              })}
            </div>
          )}

          {/* ================================================= TAB TIPOS DE GASTO */}
          {tab === 'gasto' && (
            <div className="flex flex-col gap-4">
              <div
                className="flex items-start gap-2.5 rounded-2xl border px-4 py-3"
                style={{ backgroundColor: 'rgb(245 158 11 / 0.1)', borderColor: 'rgb(245 158 11 / 0.3)' }}
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#F59E0B' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.recurrentesInfo')}
                </p>
              </div>

              <motion.div variants={containerV} initial="hidden" animate="show" className="flex flex-col gap-2">
                {typeConfigs.map((c) => {
                  const count = c.baseType ? expenseCountByType.get(c.baseType) ?? 0 : 0;
                  return (
                    <motion.div key={c.key} variants={itemV} className="card p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                        {c.recurrent && (
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                            style={{ backgroundColor: 'var(--vi-chip-bg)', color: 'var(--vi-chip-text)' }}
                          >
                            {fmtMoney(c.fixedAmount)}/mes{c.scope === 'inmueble' ? tr('aj.porInmuebleMes') : ''}
                          </span>
                        )}
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                          style={{ backgroundColor: 'var(--sl-chip-bg)', color: 'var(--sl-chip-text)' }}
                        >
                          {tr('aj.gasto', { count })}
                        </span>
                        <label className="flex items-center gap-2">
                          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                            {tr('aj.recurrente')}
                          </span>
                          <Switch
                            checked={c.recurrent}
                            onCheckedChange={(v) => updateTypeConfig(c.key, { recurrent: v })}
                          />
                        </label>
                      </div>
                      <AnimatePresence initial={false}>
                        {c.recurrent && (
                          <motion.div
                            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: EASE_OUT_QUART }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                              <label className="flex items-center gap-2">
                                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                                  {tr('aj.importeFijo')}
                                </span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={String(c.fixedAmount).replace('.', ',')}
                                  onChange={(e) => {
                                    const v = Number(e.target.value.replace(',', '.'));
                                    if (Number.isFinite(v)) updateTypeConfig(c.key, { fixedAmount: v });
                                  }}
                                  className="h-9 w-28 rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                                  style={{ borderColor: 'var(--border)' }}
                                />
                              </label>
                              <Select
                                value={c.scope}
                                onValueChange={(v) => updateTypeConfig(c.key, { scope: v as 'inmueble' | 'global' })}
                              >
                                <SelectTrigger className="h-9 w-auto min-w-[150px] gap-2 rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm font-medium shadow-none">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                                  <SelectItem value="inmueble">{tr('aj.porInmueble')}</SelectItem>
                                  <SelectItem value="global">{tr('aj.global')}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}

                <motion.button
                  variants={itemV}
                  type="button"
                  onClick={() => setNewTypeOpen(true)}
                  className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-3.5 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
                >
                  <Plus className="h-4 w-4" />
                  {tr('aj.nuevoTipo')}
                </motion.button>
              </motion.div>
            </div>
          )}

          {/* ================================================= TAB CATEGORÍAS */}
          {tab === 'categorias' && (
            <div className="flex flex-col gap-3">
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.categoriasDesc')}
              </p>
              <motion.div variants={containerV} initial="hidden" animate="show" className="flex flex-col gap-2">
                {cats.map((c) => {
                  const Icon = catIcon(c.icon);
                  return (
                    <motion.div key={c.key} variants={itemV} className="card flex items-center gap-3 p-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--ro-chip-bg)' }}>
                        <Icon className="h-4 w-4 text-rose-500" />
                      </span>
                      <input
                        value={c.label}
                        onChange={(e) => updateCat(c.key, { label: e.target.value })}
                        placeholder={tr('aj.etiqueta')}
                        className={cn(inputCls, 'h-9 flex-1')}
                        style={inputStyle}
                      />
                      <Select value={c.icon} onValueChange={(v) => updateCat(c.key, { icon: v })}>
                        <SelectTrigger className="h-9 w-[130px] rounded-xl border-[var(--border)] bg-[var(--surface)] text-sm shadow-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                          {Object.entries(CAT_ICONS).map(([name, Ico]) => (
                            <SelectItem key={name} value={name}>
                              <span className="flex items-center gap-2">
                                <Ico className="h-3.5 w-3.5" />
                                {name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        onClick={() => removeCat(c.key)}
                        aria-label={tr('aj.eliminar')}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--ro-chip-bg)]"
                        style={{ color: '#F43F5E' }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </motion.div>
                  );
                })}
                <motion.button
                  variants={itemV}
                  type="button"
                  onClick={addCat}
                  className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-3 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
                >
                  <Plus className="h-4 w-4" />
                  {tr('aj.nuevaCategoria')}
                </motion.button>
                <button
                  type="button"
                  onClick={() => void saveCats()}
                  className="brand-gradient mt-1 flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
                >
                  {tr('aj.guardar')}
                </button>
              </motion.div>
            </div>
          )}

          {/* ================================================= TAB PREFERENCIAS */}
          {tab === 'preferencias' && (
            <motion.div variants={containerV} initial="hidden" animate="show" className="card divide-y" style={{ borderColor: 'var(--border)' }}>
              {/* Tema */}
              <motion.div variants={itemV} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm font-semibold">{tr('aj.tema')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.temaDesc')}
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
                  {(
                    [
                      { id: 'claro', icon: Sun, labelKey: 'aj.claro' },
                      { id: 'oscuro', icon: Moon, labelKey: 'aj.oscuro' },
                      { id: 'auto', icon: MonitorSmartphone, labelKey: 'aj.auto' },
                    ] as const
                  ).map((m) => {
                    const active = themeMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => applyThemeMode(m.id)}
                        className={cn(
                          'flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors duration-200',
                          active ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                        )}
                        style={active ? { backgroundImage: 'linear-gradient(135deg,#6366F1,#8B5CF6)' } : undefined}
                      >
                        <m.icon className="h-3.5 w-3.5" />
                        {tr(m.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </motion.div>

              {/* Idioma */}
              <motion.div variants={itemV} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm font-semibold">{tr('aj.idioma')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.idiomaDesc')}
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
                  {(
                    [
                      { id: 'auto', label: 'Auto' },
                      { id: 'es', label: 'ES' },
                      { id: 'en', label: 'EN' },
                    ] as const
                  ).map((m) => {
                    const active = lang === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => changeLang(m.id)}
                        className={cn(
                          'flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors duration-200',
                          active ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                        )}
                        style={active ? { backgroundImage: 'linear-gradient(135deg,#6366F1,#8B5CF6)' } : undefined}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </motion.div>

              {/* API Tedee */}
              <motion.div variants={itemV} className="flex flex-col gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm font-semibold">{tr('aj.tedeeApi')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.tedeeApiDesc')}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input
                    value={tedeeUrl}
                    onChange={(e) => setTedeeUrl(e.target.value)}
                    placeholder="http://192.168.1.111"
                    aria-label={tr('aj.tedeeUrl')}
                    className={cn(inputCls, 'w-full')}
                    style={inputStyle}
                  />
                  <input
                    type="password"
                    value={tedeeToken}
                    onChange={(e) => setTedeeToken(e.target.value)}
                    placeholder={tr('aj.tedeeToken')}
                    aria-label={tr('aj.tedeeToken')}
                    className={cn(inputCls, 'w-full')}
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    disabled={!tedeeUrl.trim() || tedeeState.state === 'checking'}
                    onClick={() => void saveTedee()}
                    className="brand-gradient flex h-10 items-center justify-center rounded-xl px-4 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {tedeeState.state === 'checking' ? tr('aj.probando') : tr('aj.tedeeGuardar')}
                  </button>
                </div>
                {tedeeState.state === 'ok' && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                    <Check className="h-3.5 w-3.5" />
                    {tedeeState.text}
                  </p>
                )}
                {tedeeState.state === 'error' && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-rose-500">
                    <Ban className="h-3.5 w-3.5" />
                    {tedeeState.text}
                  </p>
                )}
              </motion.div>

              {/* Modo demo */}
              <motion.div variants={itemV} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm font-semibold">{tr('aj.modoDemo')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.modoDemoDesc')}
                  </p>
                </div>
                <Switch checked={demoOn} onCheckedChange={toggleDemo} />
              </motion.div>

              {/* Actualizaciones (solo admin) */}
              {isAdmin && (
                <motion.div variants={itemV} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <p className="text-sm font-semibold">{tr('aj.actualizaciones')}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {tr('aj.actualizacionesDesc')}
                    </p>
                  </div>
                  {updateInfo === null ? (
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>…</span>
                  ) : updateInfo.available ? (
                    <button
                      type="button"
                      disabled={applying}
                      onClick={() => void applyUpdate()}
                      className="brand-gradient flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', applying && 'animate-spin')} />
                      {applying ? tr('aj.actualizando') : tr('aj.actualizarAhora')}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                      <Check className="h-3.5 w-3.5" />
                      {tr('aj.appActualizada')}
                    </span>
                  )}
                </motion.div>
              )}

              {/* Horarios */}
              <motion.div variants={itemV} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm font-semibold">{tr('aj.horarios')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.horariosDesc')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={checkInTime}
                    onChange={(e) => { setCheckInTime(e.target.value); savePref({ checkInTime: e.target.value }); }}
                    className={cn(inputCls, 'h-9 w-[104px]')}
                    style={inputStyle}
                    aria-label={tr('aj.horaEntrada')}
                  />
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    /
                  </span>
                  <input
                    type="time"
                    value={checkOutTime}
                    onChange={(e) => { setCheckOutTime(e.target.value); savePref({ checkOutTime: e.target.value }); }}
                    className={cn(inputCls, 'h-9 w-[104px]')}
                    style={inputStyle}
                    aria-label={tr('aj.horaSalida')}
                  />
                </div>
              </motion.div>

              {/* Limpieza automática */}
              <motion.div variants={itemV} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm font-semibold">{tr('aj.limpiezaAuto')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.limpiezaAutoDesc')}
                  </p>
                </div>
                <Switch
                  checked={autoCleaning}
                  onCheckedChange={(v) => { setAutoCleaning(v); savePref({ autoCleaning: v }); }}
                  className="data-[state=checked]:bg-[#8B5CF6]"
                />
              </motion.div>

              {/* Margen limpiezas */}
              <motion.div variants={itemV} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm font-semibold">{tr('aj.margenLimpiezas')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.margenLimpiezasDesc')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={marginDays}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 0 && v <= 60) setMarginDays(v);
                    }}
                    className={cn(inputCls, 'h-9 w-20 text-center')}
                    style={inputStyle}
                    aria-label={tr('aj.margenLimpiezas')}
                  />
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {tr('aj.dias')}
                  </span>
                  <button
                    type="button"
                    onClick={saveMargin}
                    className="flex h-9 items-center rounded-xl border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    {tr('aj.guardar')}
                  </button>
                </div>
              </motion.div>

              {/* Días de aviso en el panel */}
              <motion.div variants={itemV} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm font-semibold">{tr('aj.diasAviso')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.diasAvisoDesc')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={lookaheadDays}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 1 && v <= 30) { setLookaheadDays(v); savePref({ lookaheadDays: v }); }
                    }}
                    className={cn(inputCls, 'h-9 w-20 text-center')}
                    style={inputStyle}
                    aria-label={tr('aj.diasAviso')}
                  />
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {tr('aj.dias')}
                  </span>
                </div>
              </motion.div>

              {/* Umbral batería */}
              <motion.div variants={itemV} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm font-semibold">{tr('aj.umbralBateria')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.umbralBateriaDesc')}
                  </p>
                </div>
                <div className="flex w-48 items-center gap-3">
                  <Slider
                    value={batteryThreshold}
                    onValueChange={(v) => { setBatteryThreshold(v); savePref({ batteryThreshold: v[0] }); }}
                    min={10}
                    max={50}
                    step={5}
                    className="flex-1"
                  />
                  <span className="font-display tnum w-12 text-right text-[15px] font-semibold">
                    {batteryThreshold[0]} %
                  </span>
                </div>
              </motion.div>

              {/* Cambiar contraseña */}
              <motion.button
                variants={itemV}
                type="button"
                onClick={() => { setPassForm({ current: '', next: '', repeat: '' }); setPassError(''); setPassOpen(true); }}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-[var(--surface-2)]"
              >
                <span>
                  <span className="block text-sm font-semibold">{tr('aj.cambiarPassword')}</span>
                  <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.cambiarPasswordDesc')}
                  </span>
                </span>
                <KeyRound className="h-4 w-4" style={{ color: 'var(--text-faint)' }} />
              </motion.button>

              {/* Cerrar sesión */}
              <motion.button
                variants={itemV}
                type="button"
                onClick={() => setLogoutOpen(true)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-[var(--ro-chip-bg)]"
                style={{ color: '#F43F5E' }}
              >
                <LogOut className="h-4 w-4" />
                <span className="text-sm font-semibold">{tr('aj.cerrarSesion')}</span>
              </motion.button>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ============================== Dialog edición inmueble */}
      <Dialog open={!!editProp} onOpenChange={(o) => !o && setEditProp(null)}>
        <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">
              {editProp === 'new' ? tr('aj.nuevoInmueble') : tr('aj.editarInmueble')}
            </DialogTitle>
            <DialogDescription style={{ color: 'var(--text-muted)' }}>
              {editProp === 'new'
                ? tr('aj.nuevoDesc')
                : tr('aj.editarDesc', { name: editProperty?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          {(editProperty || editProp === 'new') && (
            <div className="flex flex-col gap-3">
              <div className="relative h-28 overflow-hidden rounded-xl">
                <img src={editProperty?.photo ?? '/prop-carmen.svg'} alt={propForm.name} className="h-full w-full object-cover" />
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void handlePhotoPick(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                {editProp !== 'new' && (
                  <button
                    type="button"
                    disabled={uploadingPhoto}
                    onClick={() => photoInputRef.current?.click()}
                    className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-md disabled:opacity-60"
                    style={{ backgroundColor: 'rgb(12 20 37 / 0.55)' }}
                  >
                    {uploadingPhoto && <RefreshCw className="h-3 w-3 animate-spin" />}
                    {uploadingPhoto ? tr('aj.subiendoFoto') : tr('aj.cambiarFoto')}
                  </button>
                )}
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.nombre')}
                </span>
                <input value={propForm.name} onChange={(e) => setPropForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.direccion')}
                </span>
                <input value={propForm.address} onChange={(e) => setPropForm((f) => ({ ...f, address: e.target.value }))} className={inputCls} style={inputStyle} />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.dormitorios')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={propForm.bedrooms}
                    onChange={(e) => setPropForm((f) => ({ ...f, bedrooms: Number(e.target.value) }))}
                    className={inputCls}
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.banosLabel')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={propForm.bathrooms}
                    onChange={(e) => setPropForm((f) => ({ ...f, bathrooms: Number(e.target.value) }))}
                    className={inputCls}
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {tr('aj.superficie')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={propForm.area}
                    onChange={(e) => setPropForm((f) => ({ ...f, area: Number(e.target.value) }))}
                    className={inputCls}
                    style={inputStyle}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.icalUrl')}
                </span>
                <span className="flex items-center gap-2">
                  <input
                    value={propForm.icalUrl}
                    onChange={(e) => {
                      setPropForm((f) => ({ ...f, icalUrl: e.target.value }));
                      setIcalCheck({ state: 'idle' });
                    }}
                    className={cn(inputCls, 'flex-1')}
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    disabled={!propForm.icalUrl.trim() || icalCheck.state === 'checking'}
                    onClick={() => void verifyIcal(propForm.icalUrl.trim())}
                    className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)] disabled:opacity-40"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', icalCheck.state === 'checking' && 'animate-spin')} />
                    {icalCheck.state === 'checking' ? tr('aj.verificando') : tr('aj.verificar')}
                  </button>
                </span>
                {icalCheck.state === 'ok' && (
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-500">
                    <Check className="h-3.5 w-3.5" />
                    {tr('aj.icalValida', { count: icalCheck.count ?? 0 })}
                  </span>
                )}
                {icalCheck.state === 'error' && (
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-rose-500">
                    <Ban className="h-3.5 w-3.5" />
                    {icalErrorText()} · {tr('aj.icalAviso')}
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.checklist')}
                </span>
                <textarea
                  value={checklistText}
                  onChange={(e) => setChecklistText(e.target.value)}
                  rows={6}
                  placeholder={tr('aj.checklistPlaceholder')}
                  className="w-full resize-none rounded-xl border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                  style={inputStyle}
                />
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {tr('aj.checklistNota')}
                </span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.instrucciones')}
                </span>
                <textarea
                  value={instructionsText}
                  onChange={(e) => setInstructionsText(e.target.value)}
                  rows={5}
                  placeholder={tr('aj.instruccionesPlaceholder')}
                  className="w-full resize-none rounded-xl border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40"
                  style={inputStyle}
                />
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {tr('aj.instruccionesNota')}
                </span>
              </label>
              <button
                type="button"
                onClick={saveProp}
                className="brand-gradient mt-1 flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              >
                {tr('aj.guardar')}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ============================== Dialog edición persona */}
      <Dialog open={!!editPerson} onOpenChange={(o) => !o && setEditPerson(null)}>
        <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">{tr('aj.editarPersona')}</DialogTitle>
            <DialogDescription style={{ color: 'var(--text-muted)' }}>
              {editPerson?.role === 'limpieza' ? tr('aj.equipoLimpieza') : tr('aj.equipoMantenimiento')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Nombre
              </span>
              <input value={personForm.name} onChange={(e) => setPersonForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.movil')}
              </span>
              <input
                type="tel"
                value={personForm.phone}
                onChange={(e) => setPersonForm((f) => ({ ...f, phone: e.target.value }))}
                className={inputCls}
                style={inputStyle}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.porHora')}
                </span>
                <input
                  type="number"
                  min={0}
                  value={personForm.hourlyRate}
                  onChange={(e) => setPersonForm((f) => ({ ...f, hourlyRate: Number(e.target.value) }))}
                  className={inputCls}
                  style={inputStyle}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.especialidad')}
                </span>
                <input value={personForm.specialty} onChange={(e) => setPersonForm((f) => ({ ...f, specialty: e.target.value }))} className={inputCls} style={inputStyle} />
              </label>
            </div>
            <button
              type="button"
              onClick={savePerson}
              className="brand-gradient mt-1 flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
            >
              Guardar
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================== Dialog añadir persona */}
      <Dialog open={addPersonOpen} onOpenChange={setAddPersonOpen}>
        <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">{tr('aj.anadirPersona')}</DialogTitle>
            <DialogDescription style={{ color: 'var(--text-muted)' }}>
              {tr('aj.anadirPersonaDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.grupo')}
              </span>
              <Select value={newPersonRole} onValueChange={(v) => setNewPersonRole(v as PersonRole)}>
                <SelectTrigger className="h-10 rounded-xl border-[var(--border)] bg-[var(--surface)] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[var(--border)] bg-[var(--surface)]">
                  <SelectItem value="limpieza">{tr('aj.limpieza')}</SelectItem>
                  <SelectItem value="mantenimiento">{tr('aj.mantenimiento')}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.nombreReq')}
              </span>
              <input value={personForm.name} onChange={(e) => setPersonForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} style={inputStyle} placeholder={tr('aj.nombreApellidos')} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  Móvil
                </span>
                <input
                  type="tel"
                  value={personForm.phone}
                  onChange={(e) => setPersonForm((f) => ({ ...f, phone: e.target.value }))}
                  className={inputCls}
                  style={inputStyle}
                  placeholder="612 345 678"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {tr('aj.porHora')}
                </span>
                <input
                  type="number"
                  min={0}
                  value={personForm.hourlyRate || ''}
                  onChange={(e) => setPersonForm((f) => ({ ...f, hourlyRate: Number(e.target.value) }))}
                  className={inputCls}
                  style={inputStyle}
                  placeholder="14"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Especialidad
              </span>
              <input value={personForm.specialty} onChange={(e) => setPersonForm((f) => ({ ...f, specialty: e.target.value }))} className={inputCls} style={inputStyle} placeholder={tr('aj.limpieza')} />
            </label>
            <button
              type="button"
              onClick={addPerson}
              className="brand-gradient mt-1 flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
            >
              {tr('aj.anadirPersona')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================== Dialog nuevo usuario (gestión) */}
      <Dialog open={newUserOpen} onOpenChange={closeNewUser}>
        <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">{tr('aj.nuevoUsuario')}</DialogTitle>
            <DialogDescription style={{ color: 'var(--text-muted)' }}>
              {tr('aj.nuevoUsuarioDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.usuario')} *
              </span>
              <input
                value={userForm.name}
                onChange={(e) => setUserForm((f) => ({ ...f, name: e.target.value }))}
                className={inputCls}
                style={inputStyle}
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.password')}
              </span>
              <input
                type="password"
                value={newUserPass}
                onChange={(e) => setNewUserPass(e.target.value)}
                className={inputCls}
                style={inputStyle}
                autoComplete="new-password"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.telefono')}
              </span>
              <input
                type="tel"
                value={userForm.phone}
                onChange={(e) => setUserForm((f) => ({ ...f, phone: e.target.value }))}
                className={inputCls}
                style={inputStyle}
                placeholder="612 345 678"
              />
            </label>
            {newUserError && (
              <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400">
                {newUserError}
              </p>
            )}
            <button
              type="button"
              disabled={!userForm.name.trim() || !newUserPass}
              onClick={() => void createGestionUser()}
              className="brand-gradient mt-1 flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {tr('aj.crearUsuario')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================== Dialog nuevo tipo de gasto */}
      <Dialog open={newTypeOpen} onOpenChange={setNewTypeOpen}>
        <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">{tr('aj.nuevoTipoGasto')}</DialogTitle>
            <DialogDescription style={{ color: 'var(--text-muted)' }}>
              {tr('aj.nuevoTipoDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.nombreReq')}
              </span>
              <input value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} className={inputCls} style={inputStyle} placeholder={tr('aj.tipoPlaceholder')} />
            </label>
            <div>
              <span className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {tr('aj.color')}
              </span>
              <div className="flex flex-wrap gap-2">
                {TYPE_SWATCHES.map((c) => (
                  <motion.button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    onClick={() => setNewTypeColor(c)}
                    animate={{ scale: newTypeColor === c ? 1.1 : 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                    className={cn('h-8 w-8 rounded-full', newTypeColor === c && 'ring-2 ring-[#6366F1] ring-offset-2 ring-offset-[var(--surface)]')}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
              <span className="text-sm font-medium">{tr('aj.gastoRecurrente')}</span>
              <Switch checked={newTypeRecurrent} onCheckedChange={setNewTypeRecurrent} />
            </label>
            <button
              type="button"
              onClick={addType}
              className="brand-gradient mt-1 flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
            >
              {tr('aj.crearTipo')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================== Dialog cambiar contraseña */}
      <Dialog open={passOpen} onOpenChange={setPassOpen}>
        <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">{tr('aj.cambiarPassword')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{tr('aj.passActual')}</span>
              <input type="password" value={passForm.current} onChange={(e) => setPassForm((f) => ({ ...f, current: e.target.value }))} autoComplete="current-password" className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{tr('aj.passNueva')}</span>
              <input type="password" value={passForm.next} onChange={(e) => setPassForm((f) => ({ ...f, next: e.target.value }))} autoComplete="new-password" className={inputCls} style={inputStyle} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{tr('aj.passRepetir')}</span>
              <input type="password" value={passForm.repeat} onChange={(e) => setPassForm((f) => ({ ...f, repeat: e.target.value }))} autoComplete="new-password" className={inputCls} style={inputStyle} />
            </label>
            {passError && (
              <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400">
                {passError}
              </p>
            )}
            <button
              type="button"
              disabled={passBusy || !passForm.current || !passForm.next || !passForm.repeat}
              onClick={() => void changePassword()}
              className="brand-gradient mt-1 flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {tr('aj.guardar')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================== Confirms */}
      <ConfirmDialog
        open={!!deletePerson}
        onOpenChange={(o) => !o && setDeletePerson(null)}
        title={deletePerson ? tr('aj.eliminarPersonaQ', { name: deletePerson.name }) : ''}
        description={tr('aj.eliminarPersonaDesc')}
        confirmLabel={tr('aj.eliminar')}
        tone="danger"
        onConfirm={() => {
          if (deletePerson) {
            void data.deletePerson(deletePerson.id);
            toast.success(tr('aj.eliminado', { name: deletePerson.name }));
          }
          setDeletePerson(null);
        }}
      />

      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title={tr('aj.cerrarSesionQ')}
        description={tr('aj.cerrarSesionDesc')}
        confirmLabel={tr('aj.cerrarSesion')}
        tone="danger"
        onConfirm={() => {
          logout();
          navigate('/login', { replace: true });
        }}
      />
    </div>
  );
}
