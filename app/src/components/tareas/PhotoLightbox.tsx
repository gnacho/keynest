import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface PhotoLightboxProps {
  photos: string[];
  /** Índice de la foto visible; null = visor cerrado. */
  index: number | null;
  onIndexChange: (i: number | null) => void;
}

const SWIPE_MIN_PX = 40;

/** Visor de fotos a pantalla completa: flechas, teclado (←/→/Esc) y deslizamiento táctil. */
export default function PhotoLightbox({ photos, index, onIndexChange }: PhotoLightboxProps) {
  const { t } = useTranslation();
  const open = index !== null;
  const touchX = useRef<number | null>(null);

  const close = useCallback(() => onIndexChange(null), [onIndexChange]);
  const step = useCallback(
    (d: number) => {
      if (index === null || photos.length === 0) return;
      onIndexChange((index + d + photos.length) % photos.length);
    },
    [index, photos.length, onIndexChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, close, step]);

  return createPortal(
    <AnimatePresence>
      {open && index !== null && photos[index] && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t('tareas.visorFotos')}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={close}
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) >= SWIPE_MIN_PX) step(dx < 0 ? 1 : -1);
          }}
        >
          <button
            type="button"
            onClick={close}
            aria-label={t('tareas.cerrarVisor')}
            className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75"
          >
            <X className="h-5 w-5" />
          </button>

          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label={t('tareas.fotoAnterior')}
                className="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 sm:left-4"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                aria-label={t('tareas.fotoSiguiente')}
                className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 sm:right-4"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          <motion.img
            key={photos[index]}
            src={photos[index]}
            alt={t('tareas.foto', { n: index + 1 })}
            draggable={false}
            className="max-h-[85vh] max-w-[92vw] select-none rounded-xl object-contain shadow-overlay"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          />

          {photos.length > 1 && (
            <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white">
              {t('tareas.fotoDe', { current: index + 1, total: photos.length })}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
