import i18n from '@/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'brand' | 'danger';
  onConfirm: () => void;
}

/** Diálogo de confirmación para acciones finales (design.md §7.11). */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'brand',
  onConfirm,
}: ConfirmDialogProps) {
  const confirm = confirmLabel ?? i18n.t('common2.confirmar');
  const cancel = cancelLabel ?? i18n.t('common2.cancelar');
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl border-[var(--border)] bg-[var(--surface)] shadow-overlay">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-lg font-semibold">{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription style={{ color: 'var(--text-muted)' }}>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-xl border-[var(--border)]">{cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(
              'rounded-xl text-white',
              tone === 'brand' ? 'brand-gradient hover:brightness-110' : 'bg-rose-500 hover:bg-rose-600',
            )}
          >
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
