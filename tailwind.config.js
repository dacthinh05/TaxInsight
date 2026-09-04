/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
      },
      colors: {
        tax: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          primary: '#0d6efd',
          dark: '#0f172a'
        },
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
          navy: '#0f172a'
        }
      },
      spacing: {
        '4.5': '1.125rem',
        '7.5': '1.875rem',
        '8.5': '2.125rem',
      },
      backdropBlur: {
        'xs': '2px',
      },
      boxShadow: {
        '2xs': '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        'xs': '0 1px 2px 0 rgba(15, 23, 42, 0.05)',
        'subtle': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'card': '0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 1px 2px -1px rgba(15, 23, 42, 0.06)',
        'card-hover': '0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.06)',
        'dropdown': '0 10px 15px -3px rgba(15, 23, 42, 0.1), 0 4px 6px -4px rgba(15, 23, 42, 0.1)',
        'floating': '0 20px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.08)',
        'drawer': '-4px 0 24px -2px rgba(15, 23, 42, 0.15)',
        'modal': '0 20px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.1)'
      },
      animation: {
        'shimmer': 'shimmer 1.8s infinite',
        'pulse-fast': 'pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fadeIn': 'fadeIn 150ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slideUp': 'slideUp 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      }
    },
  },
  plugins: [],
}
