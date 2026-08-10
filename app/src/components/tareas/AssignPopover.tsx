import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Pencil, Phone, Plus, User } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import MoneyText from '@/components/MoneyText';
import PersonAvatar from '@/components/PersonAvatar';
import { useTranslation } from 'react-i18next';
import type { Person, AppUser } from '@/data/types';
import { cn } from '@/lib/utils';

interface AssignPopoverProps {
  /** Personas candidatas (ya filtradas por rol y disponibilidad) */
  people: Person[];
  /** Usuarios de la app candidatos a asignar */
  users?: AppUser[];
  /** Color del módulo: violet (limpieza) / blue (mantenimiento) */
  tone: 'violet' | 'blue';
  onSelect: (personId: string) => void;
  onSelectUser?: (userId: string) => void;
  /** 'dashed' = pill borde discontinuo "+ Asignar" · 'button' = botón secundario · 'icon' = solo icono lápiz */
  variant?: 'dashed' | 'button' | 'icon';
  label?: string;
  className?: string;
}

const TONE = {
  violet: { border: 'border-violet-400', text: 'text-violet-500' },
  blue: { border: 'border-blue-400', text: 'text-blue-500' },
};

/** Popover de asignación de persona (design limpieza/mantenimiento: "+ Asignar"). */
export default function AssignPopover({
  people,
  users,
  tone,
  onSelect,
  onSelectUser,
  variant = 'dashed',
  label,
  className,
}: AssignPopoverProps) {
  const { t: tr } = useTranslation();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const t = TONE[tone];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === 'dashed' ? (
          <button
            type="button"
            className={cn(
              'flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-xs font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]',
              t.border,
              t.text,
              className,
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            {(label ?? tr('mant.asignar')).replace(/^\+ /, '')}
          </button>
        ) : variant === 'icon' ? (
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: 'var(--text-faint)' }}
          >
            <Pencil className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              'flex h-9 items-center justify-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]',
              t.border,
              t.text,
              className,
            )}
          >
            {label ?? tr('mant.asignar')}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 rounded-2xl border-[var(--border)] bg-[var(--surface)] p-2 shadow-overlay"
      >
        <p
          className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: 'var(--text-faint)' }}
        >
          {tr('tareas.asignarA')}
        </p>
        <div className="flex flex-col">
          {people.map((p, i) => (
            <motion.button
              key={p.id}
              type="button"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              transition={
                reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 500, damping: 32, delay: i * 0.05 }
              }
              onClick={() => {
                onSelect(p.id);
                setOpen(false);
              }}
              className="flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-150 hover:bg-[var(--surface-2)]"
            >
              <PersonAvatar name={p.name} initials={p.initials} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{p.name}</span>
                <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                  {p.specialty} · <MoneyText value={p.hourlyRate} className="text-xs" />
                  /h
                </span>
                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                  <Phone className="h-3 w-3" />
                  {p.phone}
                </span>
              </span>
            </motion.button>
          ))}
          {people.length === 0 && (
            <p className="px-2 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              {tr('tareas.sinPersonas')}
            </p>
          )}
        </div>
        {users && users.length > 0 && (
          <>
            <div
              className="mx-2 my-1 border-t"
              style={{ borderColor: 'var(--border)' }}
            />
            <p
              className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: 'var(--text-faint)' }}
            >
              {tr('mant.asignarUsuario')}
            </p>
            <div className="flex flex-col">
              {users.map((u, i) => (
                <motion.button
                  key={u.id}
                  type="button"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                  transition={
                    reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 500, damping: 32, delay: i * 0.05 }
                  }
                  onClick={() => {
                    onSelectUser?.(u.id);
                    setOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-150 hover:bg-[var(--surface-2)]"
                >
                  <PersonAvatar name={u.name} initials={u.name.charAt(0).toUpperCase()} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{u.name}</span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                      <User className="h-3 w-3" />
                      {tr('aj.rol' + (u.role === 'admin' ? 'Admin' : 'User'))}
                    </span>
                  </span>
                </motion.button>
              ))}
            </div>
          </>
        )}
        {(!users || users.length === 0) && people.length === 0 && (
          <p className="px-2 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            {tr('tareas.sinPersonas')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
