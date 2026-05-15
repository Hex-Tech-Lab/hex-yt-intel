import plugin from 'tailwindcss/plugin';

/**
 * HEX-YT-INTEL Tailwind Configuration Extensions
 * Drop this into the main tailwind.config.ts or merge with the existing theme.
 */
export const hexYtIntelConfig = {
  theme: {
    extend: {
      colors: {
        cyan: {
          DEFAULT: '#06B6D4', // Primary intelligence/extraction action
        },
        indigo: {
          DEFAULT: '#6366F1', // Secondary accents
        },
        coral: {
          DEFAULT: '#FF6B6B', // Alerts and critical flags ONLY
        },
        slate: {
          950: '#0F172A', // Dark mode background
          900: '#1E293B', // Dark mode surface
          800: '#334155', // Dark mode elevated surface
          100: '#F1F5F9', // Light mode elevated surface
          50: '#FAFAFA',  // Light mode background
        },
      },
      fontFamily: {
        display: ['Geist', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'display-lg': ['64px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-md': ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        'headline-lg': ['32px', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-md': ['24px', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '500' }],
        'body-base': ['16px', { lineHeight: '1.6', letterSpacing: '0px', fontWeight: '400' }],
        'body-sm': ['14px', { lineHeight: '1.6', letterSpacing: '0px', fontWeight: '400' }],
        'caption': ['13px', { lineHeight: '1.5', letterSpacing: '0px', fontWeight: '400' }],
      },
      transitionTimingFunction: {
        'hex-ease': 'cubic-bezier(0.16, 1, 0.3, 1)', // Snappy, precise ease-out without bounce
      },
      transitionDuration: {
        'hex-fast': '150ms',
        'hex-medium': '300ms',
      },
      backdropBlur: {
        'hex-subtle': '6px', // Maps perfectly to the restrained 5-8% visual requirement
      },
    },
  },
  plugins: [
    plugin(function ({ addComponents, addUtilities }) {
      // Beautiful Shadows Mapping
      addUtilities({
        '.beautiful-shadow-sm': {
          boxShadow: '0 2px 4px rgba(0,0,0,0.05), 0 4px 8px rgba(0,0,0,0.08), 0 8px 16px rgba(0,0,0,0.1)',
        },
        '.beautiful-shadow-lg': {
          boxShadow: '0 4px 8px rgba(0,0,0,0.08), 0 8px 16px rgba(0,0,0,0.12), 0 16px 32px rgba(0,0,0,0.15)',
        },
      });

      // Outline Styling Guardrails
      addComponents({
        '.outline-card': {
          border: '1px solid rgba(255, 255, 255, 0.1)',
        },
        '.outline-card-light': {
          border: '1px solid rgba(0, 0, 0, 0.1)',
        },
      });
    }),
  ],
};