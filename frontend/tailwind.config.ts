import type { Config } from 'tailwindcss';

/**
 * Dark-teal palette. `brand.dark` is the Slack-style sidebar; `brand` /
 * `brand.light` are accents; neutrals are slate with a faint teal tint.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0f766e', // teal-700
          dark: '#082826', // deep teal — sidebar
          darker: '#041e1c',
          light: '#2dd4bf', // teal-400 — accents
          ring: '#14b8a6',
        },
        canvas: '#f8fafc',
        surface: '#ffffff',
        line: '#e5e7eb',
        ink: '#0d1716',
        muted: '#64748b',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(8, 40, 38, 0.06), 0 1px 3px rgba(8, 40, 38, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
