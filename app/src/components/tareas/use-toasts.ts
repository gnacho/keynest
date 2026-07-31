import { useCallback, useRef, useState } from 'react';
import type { SemColor } from '@/data/types';

export interface ToastItem {
  id: number;
  text: string;
  tone: SemColor;
}

/** Mini-sistema de toast local de página (el scaffold no monta un Toaster global). */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, tone: SemColor = 'emerald') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);

  return { toasts, push };
}
