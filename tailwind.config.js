/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        agar: {
          50: '#fbf7ea',
          100: '#f4ebc9',
          200: '#e9d9a6',
          300: '#dcc27a',
          400: '#cda952',
          500: '#b88e36',
        },
        bench: {
          700: '#27313a',
          800: '#1a2229',
          900: '#10161b',
          950: '#0a0e12',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
