import animate from 'tailwindcss-animate'

/**
 * AKK Hub Tailwind config.
 * Colours map to the glass design tokens in src/ui/glass.css, plus the legacy names the
 * three source apps use (brand / navy / status / shadcn hsl vars) so ported modules keep working.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        calibri: ['Calibri', 'Candara', 'Segoe', 'Segoe UI', 'Optima', 'Arial', 'sans-serif'],
        aptos: ['Aptos', 'Aptos Narrow', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        glass: 'var(--g-r-lg)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        glass: 'var(--g-sheen), var(--g-shadow-2)',
        float: 'var(--g-sheen), var(--g-shadow-3)',
      },
      colors: {
        brand: {
          DEFAULT: 'var(--g-brand)',
          hover: 'var(--g-brand-press)',
          foreground: '#ffffff',
          muted: 'var(--g-brand-muted)',
          soft: 'var(--g-brand-soft)',
        },
        bronze: {
          DEFAULT: 'var(--g-bronze)',
          soft: 'var(--g-bronze-soft)',
        },
        ink: {
          DEFAULT: 'var(--g-ink)',
          2: 'var(--g-ink-2)',
          muted: 'var(--g-muted)',
          faint: 'var(--g-faint)',
        },
        navy: {
          DEFAULT: '#0f2440',
          2: '#16345c',
          muted: '#e8eef5',
          foreground: '#ffffff',
        },
        tone: {
          timesheet: 'var(--g-tone-timesheet)',
          materials: 'var(--g-tone-materials)',
          progress: 'var(--g-tone-progress)',
          camera: 'var(--g-tone-camera)',
        },
        status: {
          incomplete: '#dbeafe',
          'incomplete-border': '#93c5fd',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        popover: 'hsl(var(--popover))',
        'popover-foreground': 'hsl(var(--popover-foreground))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        secondary: 'hsl(var(--secondary))',
        'secondary-foreground': 'hsl(var(--secondary-foreground))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        accent: 'hsl(var(--accent))',
        'accent-foreground': 'hsl(var(--accent-foreground))',
        destructive: 'hsl(var(--destructive))',
        'destructive-foreground': 'hsl(var(--destructive-foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
    },
  },
  plugins: [animate],
}
