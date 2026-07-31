import { cn } from '@/lib/utils';

const TINTS: { bg: string; text: string }[] = [
  { bg: 'var(--bl-chip-bg)', text: 'var(--bl-chip-text)' },
  { bg: 'var(--vi-chip-bg)', text: 'var(--vi-chip-text)' },
  { bg: 'var(--em-chip-bg)', text: 'var(--em-chip-text)' },
  { bg: 'var(--or-chip-bg)', text: 'var(--or-chip-text)' },
  { bg: 'var(--ro-chip-bg)', text: 'var(--ro-chip-text)' },
];

function tintFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

interface PersonAvatarProps {
  name: string;
  initials?: string;
  size?: number;
  className?: string;
}

/** Avatar con iniciales sobre tints semánticos rotativos (design.md §7.7). */
export default function PersonAvatar({ name, initials, size = 32, className }: PersonAvatarProps) {
  const tint = tintFor(name);
  const ini =
    initials ??
    name
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: tint.bg,
        color: tint.text,
        fontSize: Math.max(10, size * 0.36),
      }}
      aria-hidden
    >
      {ini}
    </span>
  );
}
