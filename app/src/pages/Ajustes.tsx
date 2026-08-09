import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import {
  Ban,
  BedDouble,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  DoorOpen,
  Euro,
  FileText,
  Info,
  Link2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Ruler,
  Settings2,
  ShieldCheck,
  Sparkles,
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
import PhotoCropDialog from '@/components/PhotoCropDialog';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslation } from 'react-i18next';
import { EXPENSE_META, EXPENSE_TYPES, TYPE_SWATCHES } from '@/components/fin/expenseMeta';
import { useData } from '@/data/useData';
import { cachedUser, demoStatus, setDemoMode } from '@/lib/auth';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { catIcon, CAT_ICONS } from '@/lib/cat-icons';
import { AppearanceCard, AboutCard, Card, InstallCard, SessionCard } from '@/components/settings/settings-cards';
import UsersManager from '@/components/settings/UsersManager';
import ImportAirbnbCard from '@/components/settings/ImportAirbnbCard';
import BackupCard from '@/components/settings/BackupCard';
import type { MaintCategory } from '@/data/types';
import type { ExpenseType, Person, PersonRole } from '@/data/types';
import { fmtDateShort, fmtMoney, fmtRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

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

type TabId = 'inmuebles' | 'personas' | 'gasto' | 'categorias' | 'preferencias';

const TABS: { id: TabId; labelKey: string; icon: LucideIcon }[] = [
  { id: 'inmuebles', labelKey: 'aj.inmuebles', icon: Building2 },
  { id: 'personas', labelKey: 'aj.personas', icon: Users },
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
  const reduce = useReducedMotion();

  const [tab, setTab] = useState<TabId>('inmuebles');

  /* ---- Inmuebles: edición real contra el backend ---- */
  const properties = data.getProperties();
  const syncStatus = data.getSyncStatus();
  const [syncing, setSyncing] = useState(false);
  const [editProp, setEditProp] = useState<string | 'new' | null>(null);
  const [icalCheck, setIcalCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; count?: number; code?: string; status?: number }>({ state: 'idle' });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoPick = (file: File | undefined) => {
    if (!file || !editProp || editProp === 'new') return;
    setCropFile(file); // abre el diálogo de recorte
  };

  /** Recorte confirmado: el diálogo devuelve un WebP 800×600 (fallback JPEG). */
  const uploadCroppedPhoto = async (blob: Blob) => {
    if (!editProp || editProp === 'new') return;
    setUploadingPhoto(true);
    try {
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
      const file = new File([blob], `foto-${editProp}.${ext}`, { type: blob.type });
      const updated = await data.uploadPropertyPhoto(editProp, file);
      if (!updated) throw new Error('upload');
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

  const [checklistText, setChecklistText] = useState('');
  const [instructionsText, setInstructionsText] = useState('');

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
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string | null; available: boolean } | null>(null);
  const [applying, setApplying] = useState(false);
  const [openPanel, setOpenPanel] = useState<'backup' | 'users' | 'audit' | null>(null);
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
      // Throttle semanal (regla app-auto-update): misma clave que el UpdateRibbon.
      const last = Number(window.localStorage.getItem('keynest-last-update-check') || 0);
      if (Date.now() - last < 7 * 24 * 60 * 60 * 1000) return;
      window.localStorage.setItem('keynest-last-update-check', String(Date.now()));
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

  const editProperty = editProp ? properties.find((p) => p.id === editProp) : undefined;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6 xl:max-w-4xl 2xl:max-w-5xl">
      <Toaster position="top-center" />

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
          {/* ==================================================== TAB INMUEBLES */}
          {tab === 'inmuebles' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {!isDemoUser && (
                  <>
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
                  </>
                )}
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
                      {!isDemoUser && (
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
                      )}
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
              <div className={cn('grid items-start gap-4', isAdmin && 'xl:grid-cols-2')}>
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

                      {/* Umbral batería */}
                      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3" style={{ borderColor: 'var(--border)' }}>
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
                  <header className="flex items-start gap-2.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'rgb(var(--warn-rgb))' }} />
                    <div>
                      <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em]">{tr('aj.zonaAdmin')}</h2>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{tr('aj.zonaAdminDesc')}</p>
                    </div>
                  </header>

                  {/* AdminBar canónica: Actualizaciones → Respaldos → Usuarios →
                      Auditoría; Modo demo a la derecha. Paneles debajo. */}
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex h-9 items-center gap-2 shrink-0">
                      <ShieldCheck className="h-5 w-5" style={{ color: 'rgb(var(--warn-rgb))' }} />
                      <h3 className="font-display text-[15px] font-semibold tracking-[-0.01em]">{tr('aj.administracion')}</h3>
                    </div>
                    <div className="hidden h-6 w-px sm:block" style={{ backgroundColor: 'var(--border)' }} />

                    {/* 1. Comprobar actualizaciones (widget inline) */}
                    <div className="flex flex-col gap-1">
                      {updateInfo === null ? (
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>…</span>
                      ) : updateInfo.available ? (
                        <button
                          type="button"
                          disabled={applying}
                          onClick={() => void applyUpdate()}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:opacity-50"
                          style={{ borderColor: 'var(--warn-rgb)', color: 'rgb(var(--warn-rgb))', backgroundColor: 'rgb(var(--warn-rgb) / 0.10)' }}
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5', applying && 'animate-spin')} />
                          {applying ? tr('aj.actualizando') : tr('aj.actualizarAhora')}
                        </button>
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
                  <div className="grid items-start gap-4 xl:grid-cols-2">
                  {/* Conexión Tedee: una fila compacta; cuando está configurada solo
                      muestra el botón de editar (la tuerca) y una burbuja de estado */}
                  <Card title={tr('aj.tedeeApi')} desc={tr('aj.tedeeApiDesc')}>
                  <div className="flex items-center gap-2.5">
                    {tedeeState.state === 'checking' && (
                      <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        {tr('aj.tedeeComprobando')}
                      </span>
                    )}
                    {tedeeState.state === 'ok' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold text-emerald-500" style={{ borderColor: 'rgb(16 185 129 / 0.3)', backgroundColor: 'rgb(16 185 129 / 0.1)' }}>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {tr('aj.tedeeConectada')}
                        {tedeeState.locks && tedeeState.locks.length > 0 && (
                          <> · {tr('aj.tedeeCerraduras', { count: tedeeState.locks.length })}</>
                        )}
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
                  </Card>

                  {/* Actualizaciones + modo demo (ahora en la AdminBar) */}

                  {/* Importar CSV de Airbnb (al lado de Tedee en la misma fila) */}
                  <ImportAirbnbCard />
                  </div>
                </div>
              )}

              <InstallCard />
              <AboutCard />
            </div>
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
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    handlePhotoPick(e.target.files?.[0]);
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
                    className={cn(inputCls, 'min-w-0 flex-1')}
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

      {/* ============================== Dialog recorte de foto (4:3 → WebP) */}
      {cropFile && (
        <PhotoCropDialog
          file={cropFile}
          open={!!cropFile}
          onClose={() => setCropFile(null)}
          onSave={uploadCroppedPhoto}
        />
      )}

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
