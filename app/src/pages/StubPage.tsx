import { Construction } from 'lucide-react';

/** Stub temporal centrado; los page agents reemplazan estas páginas. */
export default function StubPage({ title }: { title: string }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: 'var(--surface-2)' }}
      >
        <Construction className="h-7 w-7" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
      </span>
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Vista en construcción (mockup navegable)
      </p>
    </div>
  );
}
