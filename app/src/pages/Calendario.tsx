import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import FilterBar from '@/components/FilterBar';
import TipoChips from '@/components/cal-res/TipoChips';
import CalDayDetail from '@/components/cal-res/CalDayDetail';
import {
  dayInfoFor,
  kindVisible,
  monthGrid,
  parseTipoParam,
} from '@/components/cal-res/calendar-utils';
import type { DayInfo } from '@/components/cal-res/calendar-utils';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/useData';
import { addDays, capitalize, fmtMonth, isSameDay } from '@/lib/format';
import { cn } from '@/lib/utils';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];


/** Nombre corto del inmueble para celdas móviles: "Ático Marina" → "Marina", "Dúplex El Carmen" → "Carmen" */
function shortPropName(name: string): string {
  const parts = name.split(' ');
  if (parts.length === 1) return name;
  const rest = parts.slice(1);
  if (['El', 'La', 'Los', 'Las'].includes(rest[0]) && rest.length > 1) rest.shift();
  return rest.join(' ');
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

/* Barras finas de la vista "Todos los inmuebles" (semántica invariable) */
const BAR_STYLE: Record<string, string> = {
  entrada: 'linear-gradient(90deg, transparent 40%, #10B981 100%)',
  salida: 'linear-gradient(90deg, #F97316 0%, transparent 60%)',
  estancia: '#3B82F6',
  rotacion: 'linear-gradient(90deg, #F97316 0 50%, #10B981 50% 100%)',
};

/* Fondo de celda en vista filtrada (bandas mitad de celda / tints) */
const CELL_BG: Record<string, string> = {
  entrada: 'linear-gradient(90deg, transparent 50%, rgb(16 185 129 / 0.15) 100%)',
  salida: 'linear-gradient(90deg, rgb(249 115 22 / 0.15) 0%, transparent 50%)',
  estancia: 'rgb(59 130 246 / 0.12)',
  rotacion:
    'linear-gradient(100deg, rgb(249 115 22 / 0.14) 0 47%, transparent 47% 53%, rgb(16 185 129 / 0.14) 53% 100%)',
};

const KIND_TEXT: Record<string, { bg: string; text: string; solid: string }> = {
  entrada: { bg: 'var(--em-chip-bg)', text: 'var(--em-chip-text)', solid: '#10B981' },
  salida: { bg: 'var(--or-chip-bg)', text: 'var(--or-chip-text)', solid: '#F97316' },
  estancia: { bg: 'var(--bl-chip-bg)', text: 'var(--bl-chip-text)', solid: '#3B82F6' },
};

/* Chip con nombre de inmueble (vista "todos", desktop) — semántica invariable */
const NAME_CHIP_STYLE: Record<string, { backgroundColor?: string; backgroundImage?: string; color: string }> = {
  entrada: { backgroundColor: 'var(--em-chip-bg)', color: 'var(--em-chip-text)' },
  salida: { backgroundColor: 'var(--or-chip-bg)', color: 'var(--or-chip-text)' },
  estancia: { backgroundColor: 'var(--bl-chip-bg)', color: 'var(--bl-chip-text)' },
  rotacion: {
    backgroundImage:
      'linear-gradient(90deg, var(--or-chip-bg) 0 50%, var(--em-chip-bg) 50% 100%)',
    color: 'var(--or-chip-text)',
  },
  libre: { backgroundColor: 'var(--sl-chip-bg)', color: 'var(--sl-chip-text)' },
};

export default function Calendario() {
  const { t, i18n } = useTranslation();
  const data = useData();
  const reduce = useReducedMotion();
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();

  const now = new Date();
  // Letras de día lun–dom según idioma
  const WEEKDAYS = useMemo(() => {
    const base = new Date(2024, 0, 1); // lunes
    return Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' }).format(addDays(base, i)),
    );
  }, [i18n.language]);
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [dir, setDir] = useState(1);
  const [painted, setPainted] = useState(false);
  const [selected, setSelected] = useState<Date | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setPainted(true), 700);
    return () => clearTimeout(t);
  }, []);

  const inmueble = params.get('inmueble') ?? 'todos';
  const typeFilters = parseTipoParam(params.get('tipo'));
  // Modo "solo desocupado": el único filtro activo — los inmuebles LIBRES generan entradas.
  const onlyDesocupado =
    typeFilters.desocupado && !typeFilters.entrada && !typeFilters.salida && !typeFilters.estancia;
  const allProps = data.getProperties();
  const scopedProps =
    inmueble === 'todos' ? allProps : allProps.filter((p) => p.slug === inmueble);
  const filteredProp = inmueble !== 'todos' ? data.getProperty(inmueble) : undefined;
  const single = scopedProps.length === 1;
  const reservations = data.getReservations();

  const weeks = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );
  const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;
  const monthLabel = `${capitalize(fmtMonth(cursor))} ${cursor.getFullYear()}`;

  const changeMonth = (delta: number) => {
    setDir(delta);
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  };
  const goToday = () => {
    const t = new Date();
    const target = new Date(t.getFullYear(), t.getMonth(), 1);
    setDir(target.getTime() >= cursor.getTime() ? 1 : -1);
    setCursor(target);
  };

  /* Atajos desktop: ←/→ mes, T hoy */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      if (e.key === 'ArrowLeft') changeMonth(-1);
      else if (e.key === 'ArrowRight') changeMonth(1);
      else if (e.key === 't' || e.key === 'T') goToday();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  const openDay = (d: Date) => {
    setSelected(d);
    setSheetOpen(true);
  };

  const clearInmueble = () => {
    const p = new URLSearchParams(params);
    p.delete('inmueble');
    setParams(p, { replace: true });
  };

  const cellDelay = (wi: number, di: number) => (wi * 7 + di) * 0.02;

  /** Marcador de la vista filtrada: barra gruesa + huésped (desktop), pill ENT/SAL (móvil) */
  const singleMarker = (info: DayInfo) => {
    if (info.kind === 'libre') {
      // Modo "solo desocupado": el inmueble libre SÍ genera marcador
      if (!onlyDesocupado) return null;
      return (
        <div className="flex flex-col gap-[3px]">
          <div
            className="hidden h-[18px] items-center truncate rounded-md px-1.5 text-[11px] font-semibold lg:flex"
            style={{ backgroundColor: 'var(--sl-chip-bg)', color: 'var(--sl-chip-text)' }}
          >
            {t('cal.libre')}
          </div>
          <div className="h-[6px] rounded-full lg:hidden" style={{ backgroundColor: '#64748B' }} />
        </div>
      );
    }
    const dim = !kindVisible(info.kind, typeFilters);
    if (info.kind === 'rotacion') {
      const guest = info.checkIn?.guest.name ?? '';
      return (
        <div className={cn('flex flex-col gap-[3px]', dim && 'opacity-25')}>
          <div
            className="hidden h-[18px] items-center truncate rounded-md px-1.5 text-[11px] font-semibold lg:flex"
            style={{
              backgroundImage:
                'linear-gradient(90deg, var(--or-chip-bg) 0 50%, var(--em-chip-bg) 50% 100%)',
              color: 'var(--em-chip-text)',
            }}
          >
            {guest}
          </div>
          <div className="flex gap-1 lg:hidden">
            <span
              className="rounded px-1 text-[9px] font-bold leading-4"
              style={{ backgroundColor: 'var(--or-chip-bg)', color: 'var(--or-chip-text)' }}
            >
              SAL
            </span>
            <span
              className="rounded px-1 text-[9px] font-bold leading-4"
              style={{ backgroundColor: 'var(--em-chip-bg)', color: 'var(--em-chip-text)' }}
            >
              ENT
            </span>
          </div>
          <div
            className="h-[6px] rounded-full lg:hidden"
            style={{ backgroundImage: BAR_STYLE.rotacion }}
          />
        </div>
      );
    }
    const kind = info.kind as 'entrada' | 'salida' | 'estancia';
    const kt = KIND_TEXT[kind];
    const guest = (info.checkIn ?? info.checkOut ?? info.stay)?.guest.name ?? '';
    return (
      <div className={cn('flex flex-col gap-[3px]', dim && 'opacity-25')}>
        <div
          className="hidden h-[18px] items-center truncate rounded-md px-1.5 text-[11px] font-semibold lg:flex"
          style={{ backgroundColor: kt.bg, color: kt.text }}
        >
          {guest}
        </div>
        {kind !== 'estancia' && (
          <span
            className="self-start rounded px-1 text-[9px] font-bold leading-4 lg:hidden"
            style={{ backgroundColor: kt.bg, color: kt.text }}
          >
            {kind === 'entrada' ? t('cal.ent') : t('cal.sal')}
          </span>
        )}
        <div className="h-[6px] rounded-full lg:hidden" style={{ backgroundColor: kt.solid }} />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Topbar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>
            {t('cal.subtitulo')}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t('cal.mesAnterior')}
            onClick={() => changeMonth(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-150 hover:bg-[var(--surface-2)]"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="min-w-[128px] text-center font-display text-[17px] font-semibold">
            {monthLabel}
          </p>
          <button
            type="button"
            aria-label={t('cal.mesSiguiente')}
            onClick={() => changeMonth(1)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-150 hover:bg-[var(--surface-2)]"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="ml-1 h-9 rounded-full border px-4 text-sm font-semibold transition-colors duration-150 hover:bg-[var(--surface-2)]"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            {t('cal.hoy')}
          </button>
        </div>
      </div>

      {/* FilterBar + chips de tipo (leyenda) + chip removible de inmueble */}
      <div className="sticky top-14 z-30 -mx-4 flex flex-wrap items-center gap-2 bg-[var(--bg)]/90 px-4 py-2 backdrop-blur-md lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
        <FilterBar className="static z-0 -mx-0 bg-transparent px-0 py-0 backdrop-blur-none" />
        <TipoChips />
        {filteredProp && (
          <button
            type="button"
            onClick={clearInmueble}
            className="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-white"
            style={{ backgroundImage: 'linear-gradient(135deg,#6366F1,#8B5CF6)' }}
          >
            {t('cal.filtrado', { name: filteredProp.name })}
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Cabecera de semana lun–dom */}
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAYS.map((d) => (
          <p
            key={d}
            className="pb-1 text-center text-[11px] font-semibold uppercase"
            style={{ color: 'var(--text-faint)' }}
          >
            {d}
          </p>
        ))}
      </div>

      {/* Grid del mes (swipe horizontal en móvil) */}
      <motion.div
        key={monthKey}
        initial={{ opacity: 0, x: reduce ? 0 : dir * 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_QUART }}
        drag={desktop ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.12}
        onDragEnd={(_e, info) => {
          if (info.offset.x <= -60) changeMonth(1);
          else if (info.offset.x >= 60) changeMonth(-1);
        }}
        className="grid touch-pan-y grid-cols-7 gap-px overflow-hidden rounded-2xl border"
        style={{ backgroundColor: 'var(--border)', borderColor: 'var(--border)' }}
      >
        {weeks.map((week, wi) =>
          week.map((day, di) => {
            const inMonth = day.getMonth() === cursor.getMonth();
            const isToday = isSameDay(day, now);
            const infos = scopedProps.map((p) => ({
              p,
              info: dayInfoFor(reservations, p.id, day),
            }));
            const activeInfos = infos.filter((x) => x.info.kind !== 'libre');
            // Modo "solo desocupado": los inmuebles libres son las entradas
            const freeInfos = infos.filter((x) => x.info.kind === 'libre');
            const chipInfos = onlyDesocupado ? freeInfos : activeInfos;
            const singleInfo = single ? infos[0]?.info : undefined;
            const rotTitle =
              single && singleInfo?.kind === 'rotacion'
                ? t('cal.rotacion')
                : undefined;

            return (
              <motion.button
                key={day.toISOString()}
                type="button"
                title={rotTitle}
                onClick={() => openDay(day)}
                initial={painted || reduce ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: cellDelay(wi, di), ease: EASE_OUT_QUART }}
                whileTap={{ scale: 0.97 }}
                className={cn(
                  'relative flex min-h-[88px] flex-col p-1 text-left transition-[box-shadow,background-color] duration-150',
                  'hover:z-10 hover:ring-[1.5px] hover:ring-inset hover:ring-[#6366F1] lg:min-h-[112px] lg:p-1.5',
                  isToday && 'z-[1] ring-2 ring-inset ring-[#6366F1]/50',
                )}
                style={{
                  backgroundColor: !inMonth
                    ? 'var(--bg)'
                    : single && singleInfo?.kind === 'estancia'
                      ? 'rgb(59 130 246 / 0.12)'
                      : 'var(--surface)',
                  backgroundImage:
                    inMonth &&
                    single &&
                    singleInfo &&
                    singleInfo.kind !== 'libre' &&
                    singleInfo.kind !== 'estancia'
                      ? CELL_BG[singleInfo.kind]
                      : undefined,
                }}
              >
                {/* Número del día */}
                <span className="flex items-center gap-1">
                  {isToday ? (
                    <span className="brand-gradient flex h-[26px] w-[26px] items-center justify-center rounded-full font-display text-[13px] font-semibold text-white">
                      {day.getDate()}
                    </span>
                  ) : (
                    <span
                      className="flex h-[26px] w-[26px] items-center justify-center font-display text-[13px] font-medium"
                      style={{
                        color: inMonth ? 'var(--text)' : 'var(--text-faint)',
                        opacity: !inMonth
                          ? 0.5
                          : onlyDesocupado
                            ? freeInfos.length === 0
                              ? 0.25
                              : 1
                            : activeInfos.length === 0 && !typeFilters.desocupado
                              ? 0.25
                              : 1,
                      }}
                    >
                      {day.getDate()}
                    </span>
                  )}
                  {/* Dots de entrada/salida junto al número (también fuera de mes, apagados) */}
                  {single && singleInfo && (
                    <span className={cn('flex gap-0.5', !inMonth && 'opacity-45')}>
                      {(singleInfo.kind === 'salida' || singleInfo.kind === 'rotacion') && (
                        <span
                          className={cn('h-1.5 w-1.5 rounded-full', !kindVisible(singleInfo.kind, typeFilters) && 'opacity-25')}
                          style={{ backgroundColor: '#F97316' }}
                        />
                      )}
                      {(singleInfo.kind === 'entrada' || singleInfo.kind === 'rotacion') && (
                        <span
                          className={cn('h-1.5 w-1.5 rounded-full', !kindVisible(singleInfo.kind, typeFilters) && 'opacity-25')}
                          style={{ backgroundColor: '#10B981' }}
                        />
                      )}
                    </span>
                  )}
                </span>

                {/* Marcadores — también en días fuera de mes, apagados */}
                <span className={cn('mt-auto flex flex-col gap-[3px] pt-1', !inMonth && 'opacity-45')}>
                  {single && singleInfo
                    ? singleMarker(singleInfo)
                    : chipInfos.slice(0, 4).map(({ p, info }) => (
                        <span
                          key={p.id}
                          className={cn(!kindVisible(info.kind, typeFilters) && !onlyDesocupado && 'opacity-25')}
                        >
                          {/* Móvil: chip con nombre corto del inmueble */}
                          <span
                            className="flex h-[14px] items-center truncate rounded px-1 text-[9px] font-semibold leading-none lg:hidden"
                            style={NAME_CHIP_STYLE[info.kind]}
                            title={p.name}
                          >
                            {shortPropName(p.name)}
                          </span>
                          {/* Desktop: chip con el nombre completo */}
                          <span
                            className="hidden h-[16px] items-center truncate rounded-md px-1.5 text-[10px] font-semibold lg:flex"
                            style={NAME_CHIP_STYLE[info.kind]}
                            title={p.name}
                          >
                            {p.name}
                          </span>
                        </span>
                      ))}
                  {!single && chipInfos.length > 4 && (
                    <span
                      className="text-[9px] font-semibold leading-3"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      +{chipInfos.length - 4}
                    </span>
                  )}
                </span>
              </motion.button>
            );
          }),
        )}
      </motion.div>

      <CalDayDetail
        date={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        properties={scopedProps}
        onlyDesocupado={onlyDesocupado}
      />
    </div>
  );
}
