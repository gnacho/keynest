import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  text?: string;
  action?: ReactNode;
  className?: string;
}

/** Icono 48px en círculo surface-2, título display, texto muted, CTA secundario. */
export default function EmptyState({ icon: Icon, title, text, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <span
        className="mb-1 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: 'var(--surface-2)' }}
      >
        <Icon className="h-6 w-6" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
      </span>
      <p className="font-display text-base font-semibold">{title}</p>
      {text && <p className="max-w-[260px] text-sm" style={{ color: 'var(--text-muted)' }}>{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
