import type { Config } from 'tailwindcss';

/**
 * The Registrar's Accession Desk palette (generation-gallery brief §3): a lit
 * graphite examination bench — explicitly not antique cream/parchment. Exact
 * tokens decided at build, per the brief. The gallery surface applies these
 * classes on its own root, so the dashboard's other pages keep the default theme.
 */
export default {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        graphite: {
          DEFAULT: '#14161A', // ground
          raised: '#1C1F25', // panels / accessioned objects
          line: '#2A2E37', // hairline borders
        },
        vermilion: {
          DEFAULT: '#C8452D', // accession-stamp ink
          ink: '#E9573C', // legible vermilion on the graphite ground
        },
        manila: {
          DEFAULT: '#E8E1CE', // label paper / primary text
          dim: '#B8B09A', // secondary text
        },
        brass: {
          DEFAULT: '#B08948', // fittings / section accents
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
