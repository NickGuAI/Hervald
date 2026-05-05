import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './modules/**/*.{ts,tsx}'],
  darkMode: ['class', '.hv-dark'],
  theme: {
    extend: {
      colors: {
        sumi: {
          black: 'var(--hv-fg)',
          gray: 'var(--hv-fg-muted)',
          diluted: 'var(--hv-fg-subtle)',
          mist: 'var(--hv-fg-faint)',
          stone: 'var(--hv-fg-faint)',
        },
        washi: {
          white: 'var(--hv-bg)',
          aged: 'var(--hv-bg-raised)',
          shadow: 'var(--hv-bg-sunken)',
        },
        accent: {
          vermillion: '#C23B22',
          moss: '#6B7B5E',
          persimmon: '#D4763A',
          indigo: '#4A5899',
        },
        ink: {
          wash: 'var(--hv-ink-wash-01)',
          border: 'var(--hv-border-hair)',
          'border-hover': 'var(--hv-border-soft)',
          focus: 'var(--hv-ink-wash-02)',
        },
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'Hiragino Mincho Pro', 'serif'],
        body: ['Source Sans 3', '-apple-system', 'Hiragino Kaku Gothic Pro', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
      },
      fontSize: {
        display: ['2rem', { lineHeight: '1.2', fontWeight: '300' }],
        heading: ['1.375rem', { lineHeight: '1.3', fontWeight: '400' }],
        section: ['0.875rem', { lineHeight: '1.4', fontWeight: '500', letterSpacing: '0.12em' }],
        whisper: ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.08em' }],
      },
      borderRadius: {
        organic: '4px 20px 4px 20px',
        'organic-sm': '2px 12px 2px 12px',
        'organic-lg': '4px 24px 4px 24px',
        sculptural: '40% 4px 35% 4px / 4px 40% 4px 35%',
      },
      boxShadow: {
        'ink-sm': 'var(--hv-shadow-rest)',
        'ink-md': 'var(--hv-shadow-lift)',
        'ink-lg': 'var(--hv-shadow-float)',
        'ink-hover': 'var(--hv-shadow-lift)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.19, 1, 0.22, 1)',
        gentle: 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.02)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        breathe: 'breathe 2.5s ease-in-out infinite',
        'fade-in': 'fade-in 0.5s cubic-bezier(0.23, 1, 0.32, 1) forwards',
      },
      lineHeight: {
        relaxed: '1.7',
        airy: '1.8',
      },
    },
  },
  plugins: [typography],
} satisfies Config
