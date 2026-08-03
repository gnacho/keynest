// Diálogo de recorte de foto de inmueble (webapp-shell: modal híbrido).
// Recorta a 4:3 (factor de forma de la app: tarjeta 16:9 y avatares cuadrados
// usan object-cover) y exporta WebP 800×600 cal. 0.85 (fallback JPEG si el
// navegador no soporta WebP). Arrastre para encuadrar, slider para zoom.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { ZoomIn } from 'lucide-react';
import { cn } from '@/lib/utils';

const OUT_W = 800;
const OUT_H = 600; // 4:3
const QUALITY = 0.85;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface PhotoCropDialogProps {
  file: File;
  open: boolean;
  onClose: () => void;
  /** Devuelve el WebP/JPEG recortado listo para subir. */
  onSave: (blob: Blob) => void | Promise<void>;
}

/** Convierte el recorte del viewport a un Blob WebP (o JPEG como fallback). */
async function cropToBlob(img: HTMLImageElement, ox: number, oy: number, coverScale: number, zoom: number, cw: number, ch: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d no disponible');
  // sx/sy/sw/sh en píxeles NATURALES de la imagen para la porción visible
  const sx = -ox / (coverScale * zoom);
  const sy = -oy / (coverScale * zoom);
  const sw = cw / (coverScale * zoom);
  const sh = ch / (coverScale * zoom);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
  const toBlob = (type: string): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
  const webp = await toBlob('image/webp');
  // Algunos navegadores devuelven null o un PNG renombrado si no soportan WebP
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await toBlob('image/jpeg');
  if (jpeg) return jpeg;
  throw new Error('no se pudo exportar la imagen');
}

export default function PhotoCropDialog({ file, open, onClose, onSave }: PhotoCropDialogProps) {
  const { t: tr } = useTranslation();
  const reduce = useReducedMotion();
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  // El contenido vive en un portal de Radix que monta en el 2º commit: un ref
  // plano + useEffect([open]) mediría null. Con callback ref → estado, el
  // efecto se re-ejecuta cuando el elemento existe de verdad.
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // Object URL de la imagen elegida
  useEffect(() => {
    if (!open) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, open]);

  // Carga de la imagen natural
  useEffect(() => {
    if (!url) return;
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = url;
    return () => {
      el.onload = null;
      el.onerror = null;
    };
  }, [url]);

  // Medir el viewport (4:3) cuando el elemento del portal exista; ResizeObserver
  // cubre cambios de tamaño (móvil, teclado, resize de ventana)
  useEffect(() => {
    if (!open || !viewportEl) return;
    const measure = () => {
      const w = viewportEl.clientWidth;
      if (w > 0) setBox({ w, h: (w * OUT_H) / OUT_W });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewportEl);
    return () => ro.disconnect();
  }, [open, viewportEl]);

  // Escala base "cover" (la imagen cubre el recorte al zoom mínimo)
  const coverScale = img && box ? Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight) : 0;

  const clampOffset = useCallback(
    (x: number, y: number, z: number) => {
      if (!img || !box || !coverScale) return { x: 0, y: 0 };
      const iw = img.naturalWidth * coverScale * z;
      const ih = img.naturalHeight * coverScale * z;
      return {
        x: Math.min(0, Math.max(box.w - iw, x)),
        y: Math.min(0, Math.max(box.h - ih, y)),
      };
    },
    [img, box, coverScale],
  );

  // Reset al abrir / cambiar de imagen
  useEffect(() => {
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  }, [img]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    setOffset(clampOffset(drag.current.baseX + dx, drag.current.baseY + dy, zoom));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const changeZoom = (z: number) => {
    setZoom(z);
    // Al hacer zoom, mantener el centro visible
    setOffset((prev) => {
      if (!box) return prev;
      const cx = box.w / 2 - prev.x;
      const cy = box.h / 2 - prev.y;
      const ratio = z / zoom;
      return clampOffset(box.w / 2 - cx * ratio, box.h / 2 - cy * ratio, z);
    });
  };

  const save = async () => {
    if (!img || !box || !coverScale) return;
    setSaving(true);
    try {
      const blob = await cropToBlob(img, offset.x, offset.y, coverScale, zoom, box.w, box.h);
      await onSave(blob);
      onClose();
    } catch {
      /* el toast de error lo pone el llamador */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold">{tr('aj.recortarFoto')}</DialogTitle>
          <DialogDescription style={{ color: 'var(--text-muted)' }}>{tr('aj.recortarFotoDesc')}</DialogDescription>
        </DialogHeader>

        {/* Viewport de recorte 4:3 */}
        <div
          ref={setViewportEl}
          className="relative w-full touch-none select-none overflow-hidden rounded-xl"
          style={{ aspectRatio: `${OUT_W} / ${OUT_H}`, borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)', cursor: 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url && img && box && coverScale > 0 && (
            <img
              src={url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{
                width: img.naturalWidth * coverScale * zoom,
                height: img.naturalHeight * coverScale * zoom,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          {/* Guías de tercios sutiles */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/3 top-0 h-full w-px bg-white/20" />
            <div className="absolute left-2/3 top-0 h-full w-px bg-white/20" />
            <div className="absolute left-0 top-1/3 h-px w-full bg-white/20" />
            <div className="absolute left-0 top-2/3 h-px w-full bg-white/20" />
          </div>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-3">
          <ZoomIn className="h-4 w-4 shrink-0" style={{ color: 'var(--text-faint)' }} />
          <Slider
            value={[zoom]}
            onValueChange={(v) => changeZoom(v[0])}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            className="flex-1"
            aria-label={tr('aj.zoom')}
          />
          <span className="font-display tnum w-12 text-right text-[13px] font-semibold">{zoom.toFixed(1)}×</span>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 items-center rounded-xl border px-4 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            {tr('aj.cancelar')}
          </button>
          <button
            type="button"
            disabled={saving || !img}
            onClick={() => void save()}
            className={cn('brand-gradient flex h-10 items-center rounded-xl px-5 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50', reduce && 'transition-none')}
          >
            {tr('aj.guardar')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
