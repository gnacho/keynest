import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck } from 'lucide-react';
import { CHIP_COLORS } from '@/lib/semantic';
import type { ToastItem } from '@/components/tareas/use-toasts';

const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

/** Host de toasts: flotante sobre la bottom-nav (móvil) / esquina inferior (desktop). */
export default function ToastHost({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-8">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, ease: EASE_OUT_QUART }}
            className="flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold shadow-overlay"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <CircleCheck className="h-4 w-4" style={{ color: CHIP_COLORS[t.tone].dot }} />
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
