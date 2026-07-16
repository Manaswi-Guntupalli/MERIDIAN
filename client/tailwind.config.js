/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Meridian — "AI Mission Control" deep-space palette.
        ink: {
          950: '#050507', // page background (deep space)
          900: '#0A0A0F', // sidebar / deepest surface
          850: '#0E0E12', // cards
          800: '#16161D', // secondary surface
          700: '#1E1E27',
          600: '#2A2A36',
        },
        brand: {
          // AI Purple
          DEFAULT: '#8B5CF6',
          50: '#f5f3ff',
          400: '#a78bfa',
          500: '#8B5CF6',
          600: '#7C3AED',
        },
        cyan: { DEFAULT: '#00E5FF', 400: '#00E5FF', 500: '#00b8d4' },
        mint: { DEFAULT: '#00D084', 400: '#00D084' },
        amber: { DEFAULT: '#FFB020', 400: '#FFB020' },
        rose: { DEFAULT: '#FF4D6D', 400: '#FF4D6D' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(139,92,246,0.25), 0 16px 50px -12px rgba(124,58,237,0.5)',
        'glow-cyan': '0 0 0 1px rgba(0,229,255,0.2), 0 16px 50px -12px rgba(0,229,255,0.35)',
        card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 48px -32px rgba(0,0,0,0.9)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #7C3AED 0%, #00E5FF 100%)',
        'brand-radial': 'radial-gradient(120% 120% at 0% 0%, #8B5CF6 0%, #00E5FF 100%)',
        'grid-fade': 'radial-gradient(ellipse at top, rgba(139,92,246,0.16), transparent 60%)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseGlow: { '0%,100%': { opacity: 0.5 }, '50%': { opacity: 1 } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease both',
        shimmer: 'shimmer 1.6s infinite',
        pulseGlow: 'pulseGlow 2.4s ease-in-out infinite',
        'spin-slow': 'spin-slow 8s linear infinite',
        float: 'float 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
