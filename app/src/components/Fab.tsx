import { Plus } from 'lucide-react';

interface FabProps {
  onClick: () => void;
  'aria-label'?: string;
}

/** Botón flotante de acción "+" visible solo en móvil/tablet (< lg). */
export default function Fab({ onClick, 'aria-label': ariaLabel }: FabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? 'Añadir'}
      className="brand-gradient fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all duration-150 hover:brightness-110 active:scale-95 lg:hidden"
      style={{ boxShadow: '0 8px 24px rgb(0 0 0 / 0.25)' }}
    >
      <Plus className="h-6 w-6" strokeWidth={2.5} />
    </button>
  );
}
