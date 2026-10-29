import type { Config } from 'tailwindcss';

// Sun City brand: maroon #6B1A2C, gold #C9A84C, dark gray text, light gray surfaces.
export default {
  content: ['./index.html', './warehouse/*.html', './employee/*.html', './map/*.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        maroon: { DEFAULT: '#6B1A2C', dark: '#4E1220', light: '#8A2A40', tint: '#F6E9EC' },
        gold: { DEFAULT: '#C9A84C', dark: '#9C7F2B', tint: '#FBF5E0' },
        ink: { DEFAULT: '#262626', soft: '#4A4A4A' },
        surface: { DEFAULT: '#F2F2F2', card: '#FFFFFF', line: '#D4D4D4' },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      minHeight: { touch: '56px' },
      minWidth: { touch: '56px' },
    },
  },
  plugins: [],
} satisfies Config;
