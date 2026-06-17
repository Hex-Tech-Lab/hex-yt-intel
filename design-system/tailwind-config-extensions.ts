// @ts-ignore - Workspace boundary resolution issue with tailwindcss/plugin
import plugin from 'tailwindcss/plugin';

/**
 * HEX-YT-INTEL Centralized Design System
 * This is the SINGLE SOURCE OF TRUTH for design standards.
 * Consumed by /web and other design-aware packages.
 */
export const hexYtIntelConfig = {
  theme: {
    extend: {
      colors: {
        // Semantic Tokens (Obsidian-Escher)
        primary: '#06B6D4',   // Electric Cyan
        surface: '#1A1F2B',   // Primary Slate Surface
        accent: '#06B6D4',    // Brand Hue
        void: '#0B0E14',      // Deep Backdrop
        bg: '#11141D',        // App Canvas

        // Extended Palette
        cyan: {
          DEFAULT: '#06B6D4',
          300: '#67E8F9',
          500: '#06B6D4',
          600: '#0891B2',
        },
        indigo: {
          DEFAULT: '#6366F1',
        },
        coral: {
          DEFAULT: '#FF6B6B',
        },
        slate: {
          950: '#0F172A', // Dark mode background
          900: '#1E293B', // Dark mode surface
          800: '#334155', // Dark mode elevated surface
          700: '#334155',
          400: '#94A3B8',
          200: '#E2E8F0',
          100: '#F1F5F9',
          50: '#FAFAFA',
        },
        border: {
          DEFAULT: '#252A38',
          line: '#1E293B',
          strong: '#334155',
        },
      },
      fontFamily: {
        display: ['Geist', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        // Semantic Scale
        'display-lg': ['64px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-md': ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        'headline-lg': ['36px', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-md': ['24px', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '500' }],
        'body-base': ['16px', { lineHeight: '1.6', letterSpacing: '0px', fontWeight: '400' }],
        'body-sm': ['14px', { lineHeight: '1.6', letterSpacing: '0px', fontWeight: '400' }],
        'caption': ['11px', { lineHeight: '1.5', letterSpacing: '0px', fontWeight: '400' }],
      },
      borderRadius: {
        DEFAULT: '0px',
        none: '0px',
        sm: '0px',
        md: '0px',
        lg: '0px',
        xl: '0px',
        '2xl': '0px',
        '3xl': '0px',
        full: '9999px',
        card: '0px',
        control: '0px',
        pill: '0px',
      },
      transitionTimingFunction: {
        'hex-ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        flare: {
          '0%': { boxShadow: '0 0 0 1px rgba(6, 182, 212, 0.2)' },
          '50%': { boxShadow: '0 0 0 3px rgba(6, 182, 212, 0.4)' },
          '100%': { boxShadow: '0 0 0 1px rgba(6, 182, 212, 0.2)' },
        },
        slideInDown: {
          from: { opacity: '0', transform: 'translateY(-12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        flare: 'flare 2s ease-in-out infinite',
        slideInDown: 'slideInDown 0.3s ease-out forwards',
      },
      backdropBlur: {
        'hex-subtle': '6px',
      },
      },
      },
      plugins: [
        plugin(function ({ addComponents, addUtilities }: { 
          addComponents: (components: Record<string, any>) => void, 
          addUtilities: (utilities: Record<string, any>) => void 
        }) {
      addUtilities({
        '.beautiful-shadow-sm': {
          boxShadow: '0 2px 4px rgba(0,0,0,0.05), 0 4px 8px rgba(0,0,0,0.08), 0 8px 16px rgba(0,0,0,0.1)',
        },
        '.beautiful-shadow-lg': {
          boxShadow: '0 4px 8px rgba(0,0,0,0.08), 0 8px 16px rgba(0,0,0,0.12), 0 16px 32px rgba(0,0,0,0.15)',
        },
        '.cyan-glow': {
          boxShadow: '0 0 20px rgba(6, 182, 212, 0.2), 0 0 40px rgba(6, 182, 212, 0.1)',
        },
        '.clip-tessellate': {
          clipPath: 'polygon(5% 0%, 100% 0%, 95% 100%, 0% 100%)',
        },
        '.clip-tessellate-reverse': {
          clipPath: 'polygon(0% 0%, 95% 0%, 100% 100%, 5% 100%)',
        },
      });

      addComponents({
        '.outline-card': {
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '0px',
          backgroundColor: 'rgba(15, 23, 42, 0.5)',
        },
      });
      }),
      ],
      };