import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import {
  Ban,
  Check,
  ChevronDown,
  Euro,
  FileText,
  Info,
  Link2,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import PersonAvatar from '@/components/PersonAvatar';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslation } from 'react-i18next';
import { EXPENSE_META, EXPENSE_TYPES, TYPE_SWATCHES } from '@/components/fin/expenseMeta';
import { useData } from '@/data/useData';
import { cachedUser, demoStatus, setDemoMode } from '@/lib/auth';
import { api } from '@/lib/api';
import { applyRelease } from '@/lib/apply-update';
import { copyText } from '@/lib/clipboard';
import { catIcon, CAT_ICONS } from '@/lib/cat-icons';
import { AppearanceCard, AboutCard, Card, InstallCard, LookaheadRow, SessionCard } from '@/components/settings/settings-cards';
import UsersManager from '@/components/settings/UsersManager';
import ImportAirbnbCard from '@/components/settings/ImportAirbnbCard';
import BackupCard from '@/components/settings/BackupCard';
import type { MaintCategory } from '@/data/types';
import type { ExpenseType, Person, PersonRole } from '@/data/types';
import { fmtDateShort, fmtMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { notifyRibbon } from '@/lib/update-check';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

/* Enlaces de acceso por token de personas: persistidos en localStorage porque el
   servidor guarda solo el hash del token (nunca el token en claro). Sin esto, tras
   recargar la página el enlace no se puede volver a ver ni copiar. */
const PERSON_LINKS_KEY = 'keynest-person-links';

function loadStoredPersonLinks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PERSON_LINKS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function storePersonLinks(links: Record<string, string>) {
  try {
    localStorage.setItem(PERSON_LINKS_KEY, JSON.stringify(links));
  } catch {
    /* sin persistencia disponible: sigue el flujo actual */
  }
}

const containerV: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const itemV: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT_QUART } },
};

type TabId = 'personas' | 'gasto' | 'categorias' | 'preferencias';

const TABS: { id: TabId; labelKey: string; icon: LucideIcon }[] = [
  { id: 'personas', labelKey: 'aj.personas', icon: Users },
  { id: 'gasto', labelKey: 'aj.tiposGasto', icon: Wallet },
  { id: 'categorias', labelKey: 'aj.categorias', icon: Wrench },
  { id: 'preferencias', labelKey: 'aj.preferencias', icon: Settings2 },
];


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
  const reduce = useReducedMotion();

  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabId | null) ?? 'personas';
  const [tab, setTab] = useState<TabId>(TABS.some(t => t.id === initialTab) ? initialTab : 'personas');


  /* ---- Personas: BD real vía provider ---- */
  const people = data.getPeople();
  const [personLinks, setPersonLinks] = useState<Record<string, string>>(() => loadStoredPersonLinks());
  const [copiedPerson, setCopiedPerson] = useState<string | null>(null);
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const [personForm, setPersonForm] = useState({ name: '', phone: '', hourlyRate: 0, specialty: '' });
  const [deletePerson, setDeletePerson] = useState<Person | null>(null);
  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [newPersonRole, setNewPersonRole] = useState<PersonRole>('limpieza');

  /* Recupera de la BD el enlace activo de cada persona (token_cipher cifrado en server,
     GET /api/people/:id/token). Fuente de verdad = server; localStorage solo caché inicial. */
  const fetchedLinksRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = people.filter((p) => p.hasToken && !fetchedLinksRef.current.has(p.id));
    pending.forEach((p) => {
      fetchedLinksRef.current.add(p.id);
      void data
        .getPersonLink(p.id)
        .then((path) => {
          setPersonLinks((prev) => {
            if (path) {
              /* El server devuelve SOLO el path (/t/kn-...); la URL completa
                 se construye aquí con el origin, igual que en genPersonLink.
                 Sin esto, tras recargar el enlace copiado perdía el host. */
              const url = `${window.location.origin}${path}`;
              const next = { ...prev, [p.id]: url };
              storePersonLinks(next);
              return next;
            }
            if (prev[p.id]) {
              const next = { ...prev };
              delete next[p.id];
              storePersonLinks(next);
              return next;
            }
            return prev;
          });
        })
        .catch(() => {
          fetchedLinksRef.current.delete(p.id);
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.version]);


  /* ---- Categorías de mantenimiento: maestro en BD ---- */
  const [cats, setCats] = useState<MaintCategory[]>(() => data.getCategories().map((c) => ({ ...c })));
  const [editingCat, setEditingCat] = useState<string | null>(null);
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
  const [demoOn, setDemoOn] = useState(true);
  const [updateInfo, setUpdateInfo] = useState<{
    current: string; latest: string | null; available: boolean;
    readiness?: { disk: { ok: boolean; detail: string }; writable: { ok: boolean; detail: string }; concurrent: { ok: boolean; detail: string }; asset: { ok: boolean; detail: string } };
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [openPanel, setOpenPanel] = useState<'backup' | 'users' | 'audit' | null>(null);
  // Zona admin colapsable (#44): recordar la preferencia del usuario.
  const [adminOpen, setAdminOpen] = useState<boolean>(() => window.localStorage.getItem('keynest-admin-open') !== '0');
  const isAdmin = cachedUser()?.role === 'admin';
  const isDemoUser = Boolean(cachedUser()?.is_demo);
  const [syncingManual, setSyncingManual] = useState(false);

  const doManualSync = () => {
    if (syncingManual) return;
    setSyncingManual(true);
    data
      .syncNow()
      .then(() => toast.success(tr('aj.syncOk')))
      .catch(() => toast.error(tr('aj.syncError')))
      .finally(() => setSyncingManual(false));
  };

  const checkUpdate = async () => {
    try {
      const data = await api<{ current: string; latest: string | null; available: boolean }>('/api/update/status');
      setUpdateInfo(data);
      if (data?.available && data.latest) notifyRibbon(data.latest);
    } catch { /* noop */ }
  };

  const applyUpdate = async () => {
    if (applying) return;
    setApplying(true);
    try {
      const done = await applyRelease();
      toast.success(tr(done ? 'aj.actualizadoOk' : 'aj.actualizandoTarda'));
      setUpdateInfo(null);
    } catch {
      toast.error(tr('aj.errorActualizar'));
    } finally {
      setApplying(false);
    }
  };

  const rollbackUpdate = async () => {
    if (rollingBack) return;
    setRollingBack(true);
    try {
      await api('/api/updates/rollback', { method: 'POST' });
      toast.success(tr('aj.rollbackPedido'));
      setUpdateInfo(null);
    } catch {
      toast.error(tr('aj.errorRollback'));
    } finally {
      setRollingBack(false);
    }
  };

  const [tedeeUrl, setTedeeUrl] = useState('');
  const [tedeeToken, setTedeeToken] = useState('');
  const [tedeeState, setTedeeState] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; text?: string; locks?: { name: string; battery: number; online: boolean }[] }>({ state: 'idle' });
  const [tedeeConfigured, setTedeeConfigured] = useState(false);
  const [tedeeEditOpen, setTedeeEditOpen] = useState(false);
  useEffect(() => {
    void demoStatus().then(setDemoOn);
    void checkUpdate();
    void api<{ url: string; hasToken: boolean }>('/api/config/tedee')
      .then(async (d) => {
        if (!d?.url) return;
        setTedeeConfigured(Boolean(d.hasToken));
        // Comprobación de salud al entrar (sin mostrar campos si está configurada)
        setTedeeState({ state: 'checking' });
        try {
          const test = await api<{ ok: boolean; locks?: { name: string; battery: number; online: boolean }[]; code?: string }>('/api/tedee/test');
          if (test.ok) {
            setTedeeState({ state: 'ok', locks: test.locks ?? [] });
          } else {
            setTedeeState({ state: 'error', text: tr('aj.tedeeErrFetch') });
          }
        } catch {
          setTedeeState({ state: 'error', text: tr('aj.tedeeErrFetch') });
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveTedee = async () => {
    setTedeeState({ state: 'checking' });
    try {
        await api('/api/config/tedee', {
        method: 'PUT',
        body: JSON.stringify({ url: tedeeUrl.trim(), token: tedeeToken.trim() }),
      });
      const test = await api<{ ok: boolean; locks?: { name: string; battery: number; online: boolean }[]; code?: string }>('/api/tedee/test');
      if (test.ok) {
        setTedeeState({ state: 'ok', locks: test.locks ?? [] });
        setTedeeConfigured(true);
        setTedeeEditOpen(false);
        setTedeeUrl('');
        setTedeeToken('');
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
  const [checkInTime, setCheckInTime] = useState(() => data.getSettings().checkInTime);
  const [checkOutTime, setCheckOutTime] = useState(() => data.getSettings().checkOutTime);
  const [autoCleaning, setAutoCleaning] = useState(() => data.getSettings().autoCleaning);
  const [batteryThreshold, setBatteryThreshold] = useState(() => [data.getSettings().batteryThreshold]);
  const savePref = (patch: Parameters<typeof data.saveSettings>[0]) => {
    void data.saveSettings(patch).catch(() => toast.error(tr('aj.errorGuardar')));
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
      setPersonLinks((prev) => {
        const next = { ...prev, [p.id]: url };
        storePersonLinks(next);
        return next;
      });
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
      storePersonLinks(next);
      return next;
    });
    toast.success(tr('aj.enlaceRevocado'));
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


  return (
    <div className="flex w-full max-w-2xl flex-col gap-6 xl:max-w-4xl 2xl:max-w-5xl">

      {/* ============================== Topbar */}
      <div>
        <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {tr('aj.maestrosDesc')}
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
          {tab === 'personas' && (
            <div className="flex flex-col gap-6">
              {(['limpieza', 'proveedor'] as PersonRole[]).map((role) => {
                const group = people.filter((p) => p.role === role);
                const tone = role === 'limpieza' ? 'violet' : 'rose';
                const chipBg = role === 'limpieza' ? 'var(--vi-chip-bg)' : 'var(--sl-chip-bg)';
                const chipText = role === 'limpieza' ? 'var(--vi-chip-text)' : 'var(--sl-chip-text)';
                const chipDot = role === 'limpieza' ? '#8B5CF6' : '#64748B';
                return (
                  <section key={role}>
                    <p
                      className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
                      style={{ color: chipDot }}
                    >
                      {role === 'limpieza' ? tr('aj.limpieza') : tr('aj.proveedores')}
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
                              {!isDemoUser && (
                                <>
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
                                </>
                              )}
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
                            {/* Enlace de acceso por token: SOLO personal de limpieza;
                                los proveedores usan token por orden de trabajo.
                                Compacto: iconos con tooltip, sin URL ni botones de texto. */}
                            {p.role === 'limpieza' && (
                            <div className="flex items-center justify-between gap-2 border-t pt-2.5" style={{ borderColor: 'var(--border)' }}>
                              <div className="flex items-center gap-2">
                                {!isDemoUser && (
                                  <>
                                    {personLinks[p.id] ? (
                                      <button
                                        type="button"
                                        onClick={() => void copyPersonLink(p)}
                                        aria-label={tr('aj.copiarEnlace')}
                                        title={tr('aj.copiarEnlace')}
                                        className="flex h-8 w-8 items-center justify-center rounded-xl text-violet-500 transition-colors hover:bg-[var(--vi-chip-bg)]"
                                      >
                                        {copiedPerson === p.id ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                                      </button>
                                    ) : p.hasToken ? (
                                      <button
                                        type="button"
                                        onClick={() => void genPersonLink(p)}
                                        aria-label={tr('aj.regenerar')}
                                        title={tr('aj.regenerar')}
                                        className="flex h-8 w-8 items-center justify-center rounded-xl text-violet-500 transition-colors hover:bg-[var(--vi-chip-bg)]"
                                      >
                                        <RefreshCw className="h-4 w-4" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => void genPersonLink(p)}
                                        aria-label={tr('aj.activarEnlace')}
                                        title={tr('aj.activarEnlace')}
                                        className="flex h-8 w-8 items-center justify-center rounded-xl text-violet-500 transition-colors hover:bg-[var(--vi-chip-bg)]"
                                      >
                                        <Link2 className="h-4 w-4" />
                                      </button>
                                    )}
                                  </>
                                )}
                                <span
                                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                  style={{
                                    color: p.hasToken ? '#10B981' : 'var(--text-faint)',
                                    backgroundColor: p.hasToken ? 'rgba(16,185,129,0.12)' : 'transparent',
                                  }}
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: p.hasToken ? '#10B981' : 'var(--text-faint)' }}
                                  />
                                  {p.hasToken ? tr('aj.enlaceActivo') : tr('aj.sinEnlace')}
                                </span>
                              </div>
                              {!isDemoUser && (
                                <button
                                  type="button"
                                  onClick={() => void revokePersonLink(p)}
                                  aria-label={tr('aj.revocar')}
                                  title={tr('aj.revocar')}
                                  disabled={!p.hasToken}
                                  className="flex h-8 w-8 items-center justify-center rounded-xl text-rose-500 transition-colors hover:bg-[var(--ro-chip-bg)] disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                  <Ban className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                            )}
                          </motion.div>
                        );
                      })}
                      {!isDemoUser && (
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
                      )}
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
                        {!isDemoUser && (
                          <label className="flex items-center gap-2">
                            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                              {tr('aj.recurrente')}
                            </span>
                            <Switch
                              checked={c.recurrent}
                              onCheckedChange={(v) => updateTypeConfig(c.key, { recurrent: v })}
                            />
                          </label>
                        )}
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
                                  readOnly={isDemoUser}
                                  value={String(c.fixedAmount).replace('.', ',')}
                                  onChange={(e) => {
                                    const v = Number(e.target.value.replace(',', '.'));
                                    if (Number.isFinite(v)) updateTypeConfig(c.key, { fixedAmount: v });
                                  }}
                                  className="h-9 w-28 rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-[#6366F1]/40 disabled:opacity-50"
                                  style={{ borderColor: 'var(--border)' }}
                                />
                              </label>
                              <Select
                                disabled={isDemoUser}
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

                {!isDemoUser && (
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
                )}
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
                    <motion.div key={c.key} variants={itemV} className="card min-w-0 flex items-center gap-3 p-3">
                      {/* Icono clicable: abre el selector de iconos */}
                      {isDemoUser ? (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--sl-chip-bg)' }}>
                          <Icon className="h-4 w-4 text-slate-500" />
                        </span>
                      ) : (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              aria-label={tr('aj.cambiarIcono')}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--sl-chip-bg)] transition-colors hover:brightness-95"
                            >
                              <Icon className="h-4 w-4 text-slate-500" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-44 rounded-xl border-[var(--border)] bg-[var(--surface)] p-2">
                            <div className="grid grid-cols-4 gap-1.5">
                              {Object.entries(CAT_ICONS).map(([name, Ico]) => (
                                <button
                                  key={name}
                                  type="button"
                                  onClick={() => updateCat(c.key, { icon: name })}
                                  aria-label={name}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-2)]"
                                  style={c.icon === name ? { backgroundColor: 'var(--sl-chip-bg)' } : undefined}
                                >
                                  <Ico className="h-4 w-4 text-slate-500" />
                                </button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                      {/* Texto: editable con icono de lápiz */}
                      {isDemoUser ? (
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.label}</span>
                      ) : editingCat === c.key ? (
                        <input
                          autoFocus
                          value={c.label}
                          onChange={(e) => updateCat(c.key, { label: e.target.value })}
                          onBlur={() => setEditingCat(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setEditingCat(null);
                          }}
                          placeholder={tr('aj.etiqueta')}
                          className={cn(inputCls, 'h-9 min-w-0 flex-1')}
                          style={inputStyle}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingCat(c.key)}
                          className="group flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span className="min-w-0 truncate text-sm font-semibold">{c.label}</span>
                          <Pencil
                            className="h-3.5 w-3.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
                            style={{ color: 'var(--text-muted)' }}
                          />
                        </button>
                      )}
                      {!isDemoUser && (
                        <button
                          type="button"
                          onClick={() => removeCat(c.key)}
                          aria-label={tr('aj.eliminar')}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--ro-chip-bg)]"
                          style={{ color: '#F43F5E' }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </motion.div>
                  );
                })}
                {!isDemoUser && (
                  <>
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
                  </>
                )}
              </motion.div>
            </div>
          )}

          {/* ================================================= TAB PREFERENCIAS */}
          {tab === 'preferencias' && (
            <div className="flex flex-col gap-4">
              {/* Fila 1: [Apariencia | Operativa (solo admin)] — canon webapp-shell 6-Ago-2026 */}
              <div className={cn('grid items-stretch gap-4', isAdmin && 'xl:grid-cols-2')}>
                <AppearanceCard />
                {isAdmin && (
                  <Card title={tr('aj.operativa')} desc={tr('aj.operativaDesc')}>
                    <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
                      {/* Horarios */}
                      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3" style={{ borderColor: 'var(--border)' }}>
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
                      </div>

                      {/* Limpieza automática */}
                      <div className="flex min-h-14 items-center justify-between gap-3 py-3" style={{ borderColor: 'var(--border)' }}>
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
                      </div>

                      {/* Umbral batería Tedee — compacto, sin descripción */}
                      <div className="flex min-h-14 items-center justify-between gap-3 py-3" style={{ borderColor: 'var(--border)' }}>
                        <p className="text-sm font-semibold">{tr('aj.umbralBateria')}</p>
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
                      </div>

                      {/* Días de aviso — compacto, sin descripción */}
                      <div className="flex min-h-14 items-center justify-between gap-3 py-3" style={{ borderColor: 'var(--border)' }}>
                        <p className="text-sm font-semibold">{tr('aj.diasAviso')}</p>
                        <LookaheadRow />
                      </div>
                    </div>
                  </Card>
                )}
              </div>

              {/* Fila 2: Mi perfil a ancho completo, debajo de Apariencia (canon 6-Ago-2026) */}
              <SessionCard isDemo={isDemoUser} />

              {/* ============================== ZONA ADMIN (solo administradores)
                  Cabecera de ZONA (no es una tarjeta) con tinte ámbar sutil según
                  webapp-shell; agrupa todo lo que un usuario normal no puede tocar. */}
              {isAdmin && (
                <div
                  className="flex flex-col gap-4 rounded-2xl border p-4 sm:p-5"
                  style={{ borderColor: 'rgb(var(--warn-rgb) / 0.35)', backgroundColor: 'rgb(var(--warn-rgb) / 0.04)' }}
                >
                  {/* Cabecera siempre visible con el toggle de colapso (#44) */}
                  <div className="flex h-9 items-center gap-2 shrink-0">
                    <ShieldCheck className="h-5 w-5" style={{ color: 'rgb(var(--warn-rgb))' }} />
                    <h3 className="font-display text-[15px] font-semibold tracking-[-0.01em]">{tr('aj.administracion')}</h3>
                    <button
                      type="button"
                      aria-label={adminOpen ? tr('aj.administracionColapsar') : tr('aj.administracionExpandir')}
                      onClick={() => {
                        const next = !adminOpen;
                        setAdminOpen(next);
                        window.localStorage.setItem('keynest-admin-open', next ? '1' : '0');
                        if (!next) setOpenPanel(null);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-2)]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', adminOpen && 'rotate-180')} />
                    </button>
                  </div>

                  {adminOpen && (
                  <>
                  {/* AdminBar canónica: Actualizaciones → Respaldos → Usuarios →
                      Auditoría; Modo demo a la derecha. Paneles debajo. */}
                  <div className="flex flex-wrap items-start gap-3">
                    {/* 1. Comprobar actualizaciones (widget inline) */}
                    <div className="flex flex-col gap-1">
                      {updateInfo === null ? (
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>…</span>
                      ) : updateInfo.available ? (
                        <>
                          <button
                            type="button"
                            disabled={applying || Boolean(updateInfo.readiness && Object.values(updateInfo.readiness).some((r) => !r.ok))}
                            onClick={() => void applyUpdate()}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ borderColor: 'var(--warn-rgb)', color: 'rgb(var(--warn-rgb))', backgroundColor: 'rgb(var(--warn-rgb) / 0.10)' }}
                          >
                            <RefreshCw className={cn('h-3.5 w-3.5', applying && 'animate-spin')} />
                            {applying ? tr('aj.actualizando') : tr('aj.actualizarAhora')}
                          </button>
                          {updateInfo.readiness && (
                            <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                              {Object.entries(updateInfo.readiness).map(([k, r]) => (
                                <li key={k} className="flex items-center gap-1.5">
                                  <span className={cn('h-1.5 w-1.5 rounded-full', r.ok ? 'bg-emerald-500' : 'bg-rose-500')} />
                                  {r.detail}
                                </li>
                              ))}
                            </ul>
                          )}
                          <button
                            type="button"
                            disabled={rollingBack}
                            onClick={() => void rollbackUpdate()}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold text-rose-500 transition-colors hover:bg-[var(--ro-chip-bg)] disabled:opacity-50"
                            style={{ borderColor: 'rgb(244 63 94 / 0.5)' }}
                          >
                            <RotateCcw className={cn('h-3 w-3', rollingBack && 'animate-spin')} />
                            {tr('aj.rollback')}
                          </button>
                        </>
                      ) : (
                        <span className="inline-flex h-9 items-center gap-1.5 text-xs font-medium text-emerald-500">
                          <Check className="h-3.5 w-3.5" />
                          {tr('aj.appActualizada')}
                        </span>
                      )}
                    </div>

                    {/* 1b. Sincronizar datos (iCal) manualmente */}
                    <button
                      type="button"
                      onClick={doManualSync}
                      disabled={syncingManual}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors disabled:opacity-50"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', syncingManual && 'animate-spin')} />
                      {syncingManual ? tr('aj.sincronizando') : tr('aj.sincronizar')}
                    </button>

                    {/* 2. Respaldos (desplegable) */}
                    <button
                      type="button"
                      aria-expanded={openPanel === 'backup'}
                      onClick={() => setOpenPanel(openPanel === 'backup' ? null : 'backup')}
                      className={cn(
                        'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors shrink-0',
                        openPanel === 'backup'
                          ? 'font-semibold'
                          : '',
                      )}
                      style={{
                        borderColor: openPanel === 'backup' ? 'rgb(var(--warn-rgb))' : 'var(--border)',
                        color: openPanel === 'backup' ? 'rgb(var(--warn-rgb))' : 'var(--text-muted)',
                        backgroundColor: openPanel === 'backup' ? 'rgb(var(--warn-rgb) / 0.08)' : 'var(--surface-2)',
                      }}
                    >
                      <RefreshCw className="h-4 w-4 shrink-0" />
                      <span className="hidden sm:inline">{tr('aj.backup')}</span>
                      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', openPanel === 'backup' && 'rotate-180')} />
                    </button>

                    {/* 3. Usuarios (desplegable) */}
                    <button
                      type="button"
                      aria-expanded={openPanel === 'users'}
                      onClick={() => setOpenPanel(openPanel === 'users' ? null : 'users')}
                      className={cn(
                        'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors shrink-0',
                      )}
                      style={{
                        borderColor: openPanel === 'users' ? 'rgb(var(--warn-rgb))' : 'var(--border)',
                        color: openPanel === 'users' ? 'rgb(var(--warn-rgb))' : 'var(--text-muted)',
                        backgroundColor: openPanel === 'users' ? 'rgb(var(--warn-rgb) / 0.08)' : 'var(--surface-2)',
                      }}
                    >
                      <Users className="h-4 w-4 shrink-0" />
                      <span className="hidden sm:inline">{tr('aj.usuarios')}</span>
                      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', openPanel === 'users' && 'rotate-180')} />
                    </button>

                    {/* 4. Auditoría (desplegable) */}
                    <button
                      type="button"
                      aria-expanded={openPanel === 'audit'}
                      onClick={() => setOpenPanel(openPanel === 'audit' ? null : 'audit')}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors shrink-0"
                      style={{
                        borderColor: openPanel === 'audit' ? 'rgb(var(--warn-rgb))' : 'var(--border)',
                        color: openPanel === 'audit' ? 'rgb(var(--warn-rgb))' : 'var(--text-muted)',
                        backgroundColor: openPanel === 'audit' ? 'rgb(var(--warn-rgb) / 0.08)' : 'var(--surface-2)',
                      }}
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="hidden sm:inline">{tr('aj.audit')}</span>
                      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', openPanel === 'audit' && 'rotate-180')} />
                    </button>

                    {/* Modo demo a la derecha */}
                    <div className="ml-auto flex h-9 items-center gap-2">
                      <span className="hidden text-[13px] font-medium sm:inline" style={{ color: 'var(--text-muted)' }}>
                        {tr('aj.modoDemo')}
                      </span>
                      <Switch checked={demoOn} onCheckedChange={toggleDemo} />
                    </div>
                  </div>

                  {/* Paneles desplegables de la AdminBar */}
                  {openPanel === 'backup' && (
                    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                      <BackupCard />
                    </div>
                  )}
                  {openPanel === 'users' && (
                    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                      <UsersManager />
                    </div>
                  )}
                  {openPanel === 'audit' && (
                    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                      <AuditPanel />
                    </div>
                  )}

                  {/* Dominio: Tedee | Import (Operativa subió al lado de Apariencia) */}
                  <div className="grid items-stretch gap-4 xl:grid-cols-2">
                  {/* Conexión Tedee: título + estado + editar en una sola línea */}
                  <div className="card p-4 md:p-6">
                    <div className="flex items-center gap-2.5">
                      <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">{tr('aj.tedeeApi')}</h2>
                    {tedeeState.state === 'checking' && (
                      <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        {tr('aj.tedeeComprobando')}
                      </span>
                    )}
                    {tedeeState.state === 'ok' && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold text-emerald-500"
                        style={{ borderColor: 'rgb(16 185 129 / 0.3)', backgroundColor: 'rgb(16 185 129 / 0.1)' }}
                        title={tr('aj.tedeeConectada')}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className="sr-only">{tr('aj.tedeeConectada')}</span>
                      </span>
                    )}
                    {tedeeState.state === 'error' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold text-rose-500" style={{ borderColor: 'rgb(244 63 94 / 0.3)', backgroundColor: 'rgb(244 63 94 / 0.1)' }}>
                        <Ban className="h-3.5 w-3.5" />
                        {tedeeState.text}
                      </span>
                    )}
                    {tedeeState.state === 'idle' && !tedeeConfigured && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                        {tr('aj.tedeeSinConfigurar')}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={tr('aj.tedeeCambiar')}
                      title={tr('aj.tedeeCambiar')}
                      onClick={() => setTedeeEditOpen((v) => !v)}
                      className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--surface-2)]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
                    >
                      <Settings2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Formulario (oculto cuando está configurada y sana) */}
                  {(!tedeeConfigured || tedeeEditOpen) && (
                    <div className="flex flex-col gap-2">
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input
                          value={tedeeUrl}
                          onChange={(e) => setTedeeUrl(e.target.value)}
                          placeholder={tr('aj.tedeeUrlPlaceholder')}
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
                          autoComplete="new-password"
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
                      <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                        {tr('aj.tedeeNotaSeguridad')}
                      </p>
                    </div>
                  )}
                  </div>

                  {/* Actualizaciones + modo demo (ahora en la AdminBar) */}

                  {/* Importar CSV de Airbnb (al lado de Tedee en la misma fila) */}
                  <ImportAirbnbCard />
                  </div>
                    </>
                    )}
                </div>
              )}

              <InstallCard />
              <AboutCard />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ============================== Dialog edición persona */}
      <Dialog open={!!editPerson} onOpenChange={(o) => !o && setEditPerson(null)}>
        <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold">{tr('aj.editarPersona')}</DialogTitle>
            <DialogDescription style={{ color: 'var(--text-muted)' }}>
              {editPerson?.role === 'limpieza' ? tr('aj.equipoLimpieza') : tr('aj.equipoProveedores')}
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
                  <SelectItem value="proveedor">{tr('aj.proveedor')}</SelectItem>
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

    </div>
  );
}

/* ---------- Auditoría (AdminBar): consume GET /api/audit (solo admin) ---------- */
interface AuditRow {
  id: number;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: string | null;
  at: number;
}

function AuditPanel() {
  const { t: tr } = useTranslation();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    api<{ entries?: AuditRow[] }>('/api/audit')
      .then((d) => setRows(d.entries ?? []))
      .catch(() => setRows([]))
      .finally(() => setBusy(false));
  }, []);

  if (busy) return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>…</p>;

  if (rows.length === 0) {
    return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{tr('aj.auditEmpty')}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tr('aj.auditWhen')}</TableHead>
            <TableHead>{tr('aj.auditUser')}</TableHead>
            <TableHead>{tr('aj.auditAction')}</TableHead>
            <TableHead>{tr('aj.auditEntity')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {fmtDateShort(new Date(r.at))}
              </TableCell>
              <TableCell className="text-[13px]">{r.user_id ?? '—'}</TableCell>
              <TableCell className="text-[13px]">{r.action}</TableCell>
              <TableCell className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {r.entity}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
