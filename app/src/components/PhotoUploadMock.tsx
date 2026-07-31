import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Camera, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const MOCK_POOL = ['/clean-1.svg', '/clean-2.svg', '/clean-3.svg', '/clean-4.svg'];

interface PhotoUploadMockProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  className?: string;
}

/**
 * Zona punteada violet con icono cámara; al click añade thumbnails mock
 * con stagger 60ms; cada thumb con botón × (design.md §7.12).
 */
export default function PhotoUploadMock({ photos, onChange, className }: PhotoUploadMockProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [poolIdx, setPoolIdx] = useState(0);

  const addPhoto = () => {
    const next = MOCK_POOL[poolIdx % MOCK_POOL.length];
    setPoolIdx((i) => i + 1);
    onChange([...photos, next]);
  };

  const removePhoto = (idx: number) => {
    onChange(photos.filter((_, i) => i !== idx));
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <button
        type="button"
        onClick={addPhoto}
        className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed transition-colors duration-150 hover:bg-[var(--vi-chip-bg)]/40"
        style={{ borderColor: 'rgb(139 92 246 / 0.45)' }}
      >
        <Camera className="h-6 w-6 text-violet-500" strokeWidth={1.8} />
        <span className="text-xs font-semibold text-violet-500">{t('common2.anadirFoto')}</span>
      </button>
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <AnimatePresence initial={false}>
            {photos.map((src, i) => (
              <motion.div
                key={`${src}-${i}`}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.25, delay: reduce ? 0 : 0.06 }}
                className="relative h-16 w-16 overflow-hidden rounded-xl border"
                style={{ borderColor: 'var(--border)' }}
              >
                <img src={src} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label={t('tareas.eliminarFoto')}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
