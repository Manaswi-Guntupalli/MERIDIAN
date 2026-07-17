/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * "Calm institutional" — a warm, light, education-first system.
         * Every accent's `400` step is tuned to be ACCESSIBLE as text on the
         * warm canvas, while `/10` gives a tint and `/25` a hairline. One token
         * therefore serves text, fill and border without extra scales.
         */

        // Neutral surfaces (warm, never pure grey — greys read cold/clinical)
        ink: {
          950: '#FBFAF7', // canvas — warm off-white page
          900: '#FFFFFF', // raised surface / sidebar
          850: '#FFFFFF', // cards
          800: '#F3F1EB', // subtle fill (hover, wells)
          700: '#E7E3DA', // stronger fill
          600: '#D8D3C7',
        },
        line: '#E8E4DA', // warm hairline divider
        canvas: '#FBFAF7',
        surface: '#FFFFFF',

        // Primary — deep teal. Trustworthy, calm, institutional.
        brand: {
          50: '#EDF6F4',
          100: '#D2EAE4',
          200: '#A6D6CB',
          400: '#0E7C6B',
          500: '#0E7C6B',
          600: '#0A6558',
          700: '#084E45',
        },
        // Secondary — soft emerald (growth, success)
        mint: { DEFAULT: '#1E8A63', 400: '#1E8A63', 500: '#177355' },
        // Info — deep aqua
        cyan: { DEFAULT: '#1F6F8B', 400: '#1F6F8B', 500: '#195A72' },
        // Warning — bronzed amber (accessible on light)
        amber: { DEFAULT: '#A76A12', 400: '#A76A12', 500: '#8A570D' },
        // Danger — muted brick, never alarming red
        rose: { DEFAULT: '#C0453B', 400: '#C0453B', 500: '#A33830' },
        // Accent — warm coral, used sparingly for human moments
        coral: { DEFAULT: '#E86A4F', 400: '#D2543A', 500: '#B84630' },
        // Highlight — golden
        gold: { DEFAULT: '#C98A21', 400: '#C98A21', 500: '#A8721A' },
      },
      fontFamily: {
        // Fraunces (optical serif) for titles & figures — the signature.
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        // Restrained, considered radii — not pill-everything.
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '14px',
        '2xl': '18px',
      },
      boxShadow: {
        // Layered, physical depth — no coloured glow.
        xs: '0 1px 2px rgba(28, 32, 31, 0.04)',
        sm: '0 1px 2px rgba(28, 32, 31, 0.05), 0 1px 3px rgba(28, 32, 31, 0.04)',
        md: '0 2px 4px rgba(28, 32, 31, 0.04), 0 4px 12px rgba(28, 32, 31, 0.06)',
        lg: '0 4px 8px rgba(28, 32, 31, 0.04), 0 12px 28px rgba(28, 32, 31, 0.08)',
        xl: '0 8px 16px rgba(28, 32, 31, 0.05), 0 24px 48px rgba(28, 32, 31, 0.10)',
        ring: '0 0 0 4px rgba(14, 124, 107, 0.12)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseGlow: { '0%,100%': { opacity: 0.45 }, '50%': { opacity: 1 } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.35s cubic-bezier(0.16,1,0.3,1) both',
        shimmer: 'shimmer 1.5s infinite',
        pulseGlow: 'pulseGlow 2.4s ease-in-out infinite',
        'spin-slow': 'spin-slow 8s linear infinite',
      },
    },
  },
  plugins: [],
};
