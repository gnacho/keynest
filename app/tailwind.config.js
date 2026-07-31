/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tokens de tema (design.md §3.1)
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        border: 'var(--border)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        'text-faint': 'var(--text-faint)',
        // Marca (design.md §3.2)
        brand: '#6366F1',
        'brand-2': '#8B5CF6',
        // Alias para componentes shadcn/ui sobre los tokens
        background: 'var(--bg)',
        foreground: 'var(--text)',
        input: 'var(--border)',
        ring: '#6366F1',
        primary: {
          DEFAULT: '#6366F1',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: 'var(--surface-2)',
          foreground: 'var(--text)',
        },
        destructive: {
          DEFAULT: '#F43F5E',
          foreground: '#FFFFFF',
        },
        muted: {
          DEFAULT: 'var(--surface-2)',
          foreground: 'var(--text-muted)',
        },
        accent: {
          DEFAULT: 'var(--surface-2)',
          foreground: 'var(--text)',
        },
        popover: {
          DEFAULT: 'var(--surface)',
          foreground: 'var(--text)',
        },
        card: {
          DEFAULT: 'var(--surface)',
          foreground: 'var(--text)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '16px',
        xl: '12px',
        lg: '12px',
        md: '10px',
        sm: '8px',
      },
      boxShadow: {
        card: 'var(--card-shadow)',
        overlay: 'var(--overlay-shadow)',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'caret-blink': {
          '0%,70%,100%': { opacity: '1' },
          '20%,50%': { opacity: '0' },
        },
        'dot-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.55', transform: 'scale(0.82)' },
        },
        'ring-pulse': {
          '0%': { boxShadow: '0 0 0 0 rgb(139 92 246 / 0.35)' },
          '70%': { boxShadow: '0 0 0 8px rgb(139 92 246 / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(139 92 246 / 0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'caret-blink': 'caret-blink 1.25s ease-out infinite',
        'dot-pulse': 'dot-pulse 1.6s ease-in-out infinite',
        'ring-pulse': 'ring-pulse 2s ease-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
