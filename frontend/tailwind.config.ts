import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
      },
      colors: {
        'bg-app':        'var(--bg-app)',
        'bg-card':       'var(--bg-card)',
        'bg-subtle':     'var(--bg-subtle)',
        'text-primary':  'var(--text-primary)',
        'text-muted':    'var(--text-muted)',
        'text-faint':    'var(--text-faint)',
        accent:          'var(--accent)',
        'accent-hover':  'var(--accent-hover)',
        'accent-active': 'var(--accent-active)',
        'accent-soft':   'var(--accent-soft)',
        'accent-ink':    'var(--accent-ink)',
        warn:            'var(--warn)',
        'warn-soft':     'var(--warn-soft)',
        'warn-strong':   'var(--warn-strong)',
        'border-subtle': 'var(--border-subtle)',
        'border-strong': 'var(--border-strong)',
        // shadcn/ui compatibility — mapped to our tokens
        background:      'var(--background)',
        foreground:      'var(--foreground)',
        border:          'var(--border)',
        input:           'var(--input)',
        ring:            'var(--ring)',
        primary:         { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
        secondary:       { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
        muted:           { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
        destructive:     { DEFAULT: 'var(--destructive)' },
        popover:         { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
        card:            { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
      },
      borderRadius: {
        input:  'var(--radius-input)',
        card:   'var(--radius-card)',
        sheet:  'var(--radius-sheet)',
        btn:    'var(--radius-btn)',
        badge:  'var(--radius-badge)',
      },
      boxShadow: {
        card:   'var(--shadow-card)',
        lift:   'var(--shadow-lift)',
        sheet:  'var(--shadow-sheet)',
      },
      transitionDuration: {
        fast:   'var(--motion-fast)',
        medium: 'var(--motion-medium)',
        slow:   'var(--motion-slow)',
      },
      transitionTimingFunction: {
        'expo-out': 'var(--ease-out-expo)',
      },
    },
  },
  plugins: [],
} satisfies Config
