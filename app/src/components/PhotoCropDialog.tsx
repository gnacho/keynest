import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { ZoomIn, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_MAX_LONG_SIDE = 1200;
const DEFAULT_QUALITY = 0.85;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.01;
const KEY_PAN = 10;
const KEY_ZOOM = 0.1;
const SIZE_DEBOUNCE = 150;

async function getExifOrientation(file: File): Promise<number> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/jpg') return 0;
  const buf = await file.slice(0, 128 * 1024).arrayBuffer();
  const v = new DataView(buf);
  if (v.getUint16(0) !== 0xffd8) return 0;
  let off = 2;
  while (off < v.byteLength - 1) {
    const m = v.getUint16(off);
    if (m === 0xffe1) {
      if (v.getUint32(off + 4) !== 0x45786966) return 0;
      const t = off + 10;
      const le = v.getUint16(t) === 0x4949;
      const ifd = t + v.getUint32(t + 4, le);
      const n = v.getUint16(ifd, le);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
      }
      return 0;
    }
    if ((m & 0xff00) !== 0xff00) break;
    off += 2 + v.getUint16(off + 2);
  }
  return 0;
}

function applyExif(img: HTMLImageElement, o: number): { c: HTMLCanvasElement; w: number; h: number } {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const swap = o >= 5 && o <= 8;
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  switch (o) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
    default: c.width = w; c.height = h;
  }
  ctx.drawImage(img, 0, 0, w, h);
  return { c, w: c.width, h: c.height };
}

function downsample(src: HTMLCanvasElement | HTMLImageElement, tw: number, th: number): HTMLCanvasElement {
  const sw = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth;
  const sh = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight;
  if (tw >= sw / 2 && th >= sh / 2) {
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    c.getContext('2d')!.drawImage(src, 0, 0, tw, th);
    return c;
  }
  let cur: HTMLCanvasElement | HTMLImageElement = src;
  let cw = sw, ch = sh;
  while (cw / 2 > tw && ch / 2 > th) {
    const hw = Math.round(cw / 2), hh = Math.round(ch / 2);
    const s = document.createElement('canvas');
    s.width = hw; s.height = hh;
    const sc = s.getContext('2d')!;
    sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = 'high';
    sc.drawImage(cur, 0, 0, hw, hh);
    cur = s; cw = hw; ch = hh;
  }
  const f = document.createElement('canvas');
  f.width = tw; f.height = th;
  const fc = f.getContext('2d')!;
  fc.imageSmoothingEnabled = true; fc.imageSmoothingQuality = 'high';
  fc.drawImage(cur, 0, 0, tw, th);
  return f;
}

async function cropToBlob(
  img: HTMLImageElement, exif: number, ox: number, oy: number,
  scale: number, zoom: number, vw: number, vh: number,
  ratio: number, maxSide: number, quality: number,
): Promise<Blob> {
  const [outW, outH] = ratio >= 1
    ? [maxSide, Math.round(maxSide / ratio)]
    : [Math.round(maxSide * ratio), maxSide];
  const corrected = applyExif(img, exif || 1);
  const sx = -ox / (scale * zoom), sy = -oy / (scale * zoom);
  const sw = vw / (scale * zoom), sh = vh / (scale * zoom);
  const crop = document.createElement('canvas');
  crop.width = Math.round(sw); crop.height = Math.round(sh);
  crop.getContext('2d')!.drawImage(corrected.c, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
  const final = downsample(crop, outW, outH);
  const tb = (t: string): Promise<Blob | null> => new Promise((r) => final.toBlob(r, t, quality));
  const webp = await tb('image/webp');
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await tb('image/jpeg');
  if (jpeg) return jpeg;
  throw new Error('export failed');
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  file: File;
  open: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => void | Promise<void>;
  aspectRatio?: number;
  maxLongSide?: number;
  quality?: number;
  allowedRatios?: number[];
}

export default function PhotoCropDialog({
  file, open, onClose, onSave,
  aspectRatio = 4 / 3,
  maxLongSide = DEFAULT_MAX_LONG_SIDE,
  quality = DEFAULT_QUALITY,
  allowedRatios = [4 / 3, 16 / 9, 1, 0],
}: Props) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [exif, setExif] = useState(0);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [ratio, setRatio] = useState(aspectRatio);
  const free = ratio === 0;
  const [estSize, setEstSize] = useState<number | null>(null);
  const [estFmt, setEstFmt] = useState('');
  const sizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [vpEl, setVpEl] = useState<HTMLDivElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null);
  const lastTap = useRef(0);
  const pinch = useRef<{ d: number; z: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, open]);

  useEffect(() => {
    if (!url) return;
    const el = new Image();
    el.onload = () => { setImg(el); getExifOrientation(file).then(setExif); };
    el.onerror = () => setImg(null);
    el.src = url;
    return () => { el.onload = null; el.onerror = null; };
  }, [url, file]);

  useEffect(() => {
    if (!open || !vpEl) return;
    const m = () => {
      const w = vpEl.clientWidth;
      if (w > 0) setBox({ w, h: free ? vpEl.clientHeight : w / (ratio || 1) });
    };
    m();
    const ro = new ResizeObserver(m);
    ro.observe(vpEl);
    return () => ro.disconnect();
  }, [open, vpEl, ratio, free]);

  const coverScale = img && box ? Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight) : 0;

  const clamp = useCallback((x: number, y: number, z: number) => {
    if (!img || !box || !coverScale) return { x: 0, y: 0 };
    const iw = img.naturalWidth * coverScale * z;
    const ih = img.naturalHeight * coverScale * z;
    return { x: Math.min(0, Math.max(box.w - iw, x)), y: Math.min(0, Math.max(box.h - ih, y)) };
  }, [img, box, coverScale]);

  useEffect(() => { setZoom(MIN_ZOOM); setOffset({ x: 0, y: 0 }); setEstSize(null); }, [img]);

  useEffect(() => {
    if (!img || !box || !coverScale || !open) return;
    if (sizeTimer.current) clearTimeout(sizeTimer.current);
    sizeTimer.current = setTimeout(async () => {
      try {
        const corrected = applyExif(img, exif || 1);
        const sw = box.w / (coverScale * zoom), sh = box.h / (coverScale * zoom);
        const cc = document.createElement('canvas');
        cc.width = Math.round(sw); cc.height = Math.round(sh);
        cc.getContext('2d')!.drawImage(corrected.c, 0, 0, cc.width, cc.height);
        const tr = free ? box.w / box.h : ratio;
        const [ow, oh] = tr >= 1 ? [maxLongSide, Math.round(maxLongSide / tr)] : [Math.round(maxLongSide * tr), maxLongSide];
        const fc = downsample(cc, ow, oh);
        const tb = (t: string): Promise<Blob | null> => new Promise((r) => fc.toBlob(r, t, quality));
        const w = await tb('image/webp');
        if (w && w.type === 'image/webp') { setEstSize(w.size); setEstFmt('WebP'); return; }
        const j = await tb('image/jpeg');
        if (j) { setEstSize(j.size); setEstFmt('JPEG'); }
      } catch { setEstSize(null); }
    }, SIZE_DEBOUNCE);
    return () => { if (sizeTimer.current) clearTimeout(sizeTimer.current); };
  }, [img, box, coverScale, zoom, offset, ratio, free, maxLongSide, quality, exif, open]);

  const onPtrDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, bx: offset.x, by: offset.y };
    const now = Date.now();
    if (now - lastTap.current < 300) { setZoom(MIN_ZOOM); setOffset({ x: 0, y: 0 }); }
    lastTap.current = now;
  };
  const onPtrMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset(clamp(drag.current.bx + e.clientX - drag.current.sx, drag.current.by + e.clientY - drag.current.sy, zoom));
  };
  const onPtrUp = () => { drag.current = null; };

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev - e.deltaY * 0.001));
      setOffset((o) => {
        if (!box) return o;
        const cx = box.w / 2 - o.x, cy = box.h / 2 - o.y;
        const r = next / prev;
        return clamp(box.w / 2 - cx * r, box.h / 2 - cy * r, next);
      });
      return next;
    });
  }, [box, clamp]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (!pinch.current) { pinch.current = { d, z: zoom }; }
      else {
        const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.current.z * (d / pinch.current.d)));
        setZoom(nz);
        setOffset((o) => {
          if (!box) return o;
          const cx = box.w / 2 - o.x, cy = box.h / 2 - o.y;
          const r = nz / zoom;
          return clamp(box.w / 2 - cx * r, box.h / 2 - cy * r, nz);
        });
      }
    }
  }, [box, zoom, clamp]);
  const onTouchEnd = useCallback(() => { pinch.current = null; }, []);

  const changeZoom = (z: number) => {
    setZoom(z);
    setOffset((o) => {
      if (!box) return o;
      const cx = box.w / 2 - o.x, cy = box.h / 2 - o.y;
      const r = z / zoom;
      return clamp(box.w / 2 - cx * r, box.h / 2 - cy * r, z);
    });
  };

  const save = async () => {
    if (!img || !box || !coverScale) return;
    setSaving(true);
    try {
      const tr = free ? box.w / box.h : ratio;
      const blob = await cropToBlob(img, exif, offset.x, offset.y, coverScale, zoom, box.w, box.h, tr, maxLongSide, quality);
      await onSave(blob);
      onClose();
    } catch { /* caller handles */ }
    finally { setSaving(false); }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); setOffset((o) => clamp(o.x + KEY_PAN, o.y, zoom)); break;
        case 'ArrowRight': e.preventDefault(); setOffset((o) => clamp(o.x - KEY_PAN, o.y, zoom)); break;
        case 'ArrowUp': e.preventDefault(); setOffset((o) => clamp(o.x, o.y + KEY_PAN, zoom)); break;
        case 'ArrowDown': e.preventDefault(); setOffset((o) => clamp(o.x, o.y - KEY_PAN, zoom)); break;
        case '+': case '=': e.preventDefault(); setZoom((z) => Math.min(MAX_ZOOM, z + KEY_ZOOM)); break;
        case '-': case '_': e.preventDefault(); setZoom((z) => Math.max(MIN_ZOOM, z - KEY_ZOOM)); break;
        case 'Enter': e.preventDefault(); void save(); break;
        case 'Escape': e.preventDefault(); onClose(); break;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, zoom, clamp, onClose]);

  const ratioLabel = (r: number) => {
    if (r === 0) return t('crop.free');
    const e = ([[4 / 3, '4:3'], [16 / 9, '16:9'], [1, '1:1'], [3 / 4, '3:4'], [9 / 16, '9:16']] as [number, string][])
      .find(([v]) => Math.abs(v - r) < 0.001);
    return e ? e[1] : r.toFixed(2);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold">{t('crop.title')}</DialogTitle>
          <DialogDescription style={{ color: 'var(--text-muted)' }}>{t('crop.desc')}</DialogDescription>
        </DialogHeader>

        {allowedRatios.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {allowedRatios.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRatio(r)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors',
                  Math.abs(ratio - r) < 0.001
                    ? 'border-transparent text-white brand-gradient'
                    : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
                )}
              >
                {ratioLabel(r)}
              </button>
            ))}
          </div>
        )}

        <div
          ref={setVpEl}
          role="application"
          tabIndex={0}
          aria-label={t('crop.viewport')}
          className="relative w-full touch-none select-none overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          style={{
            aspectRatio: free ? undefined : `${ratio}`,
            height: free ? '240px' : undefined,
            borderColor: 'var(--border)',
            backgroundColor: 'var(--surface-2)',
            cursor: 'grab',
          }}
          onPointerDown={onPtrDown}
          onPointerMove={onPtrMove}
          onPointerUp={onPtrUp}
          onPointerCancel={onPtrUp}
          onWheel={onWheel}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
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
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/3 top-0 h-full w-px bg-white/20" />
            <div className="absolute left-2/3 top-0 h-full w-px bg-white/20" />
            <div className="absolute left-0 top-1/3 h-px w-full bg-white/20" />
            <div className="absolute left-0 top-2/3 h-px w-full bg-white/20" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ZoomIn className="h-4 w-4 shrink-0" style={{ color: 'var(--text-faint)' }} />
          <Slider
            value={[zoom]}
            onValueChange={(v) => changeZoom(v[0])}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={ZOOM_STEP}
            className="flex-1"
            aria-label={t('crop.zoom')}
          />
          <span className="font-display tnum w-12 text-right text-[13px] font-semibold">{zoom.toFixed(1)}×</span>
        </div>

        {estSize !== null && (
          <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
            <RotateCcw className="h-3 w-3" />
            <span>~{fmtBytes(estSize)} {estFmt}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 items-center rounded-xl border px-4 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            {t('crop.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !img}
            onClick={() => void save()}
            className={cn('brand-gradient flex h-10 items-center rounded-xl px-5 text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50', reduce && 'transition-none')}
          >
            {saving ? t('crop.saving') : t('crop.save')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
