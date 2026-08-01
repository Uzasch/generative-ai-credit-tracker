import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./entrypoints/**/*.{ts,tsx,html}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
