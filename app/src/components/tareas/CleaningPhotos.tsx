import { useRef, useState } from 'react';
import { Camera, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PhotoLightbox from '@/components/tareas/PhotoLightbox';
import { cn } from '@/lib/utils';

interface CleaningPhotosProps {
  photos: string[];
  /** Sube el fichero y devuelve la lista actualizada de fotos (o undefined si falla). */
  onUpload: (file: File) => Promise<string[] | undefined>;
  /** Elimina una foto (solo vista propietario). */
  onRemove?: (url: string) => void;
}

/** Fotos reales de una limpieza: galería/cámara del móvil (input file) + subida al servidor. */
export default function CleaningPhotos({ photos, onUpload, onRemove }: CleaningPhotosProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    await onUpload(file);
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((src, i) => (
          <span key={`${src}-${i}`} className="relative">
            <button
              type="button"
              onClick={() => setViewer(i)}
              aria-label={t('tareas.verFoto', { n: i + 1 })}
              className="block h-16 w-16 overflow-hidden rounded-xl border transition-transform duration-150 hover:-translate-y-0.5"
              style={{ borderColor: 'var(--border)' }}
            >
              <img src={src} alt={t('tareas.foto', { n: i + 1 })} className="h-full w-full object-cover" />
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(src)}
                aria-label={t('tareas.eliminarFoto')}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition-colors hover:bg-[var(--surface-2)]',
            busy && 'opacity-50',
          )}
          style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
          aria-label={t('tareas.anadirFotoReal')}
        >
          {busy ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
          ) : (
            <>
              <Camera className="h-4 w-4 text-violet-500" />
              <Plus className="h-3 w-3" />
            </>
          )}
        </button>
      </div>
      <PhotoLightbox photos={photos} index={viewer} onIndexChange={setViewer} />
    </div>
  );
}
