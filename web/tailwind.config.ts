import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // ENFORCE DESIGN.MD: Strict ban on rounded corners
    borderRadius: {
      none: "0px",
    },
    extend: {
      colors: {
        // Obsidian-Escher Core Tokens
        obsidian: "#000000",
        "cyan-electric": "#00D9FF",
        "white-pure": "#FFFFFF",
        "surface-dark": "#1A1A1A",
        "border-light": "#404040",
        
        // Semantic Status Colors
        success: "#4ADE80",
        warning: "#FACC15",
        error: "#F87171",
        info: "#38BDF8",

        // Aliased Legacy Tokens (Mapped to pure Obsidian-Escher values for backward compatibility)
        void: "#000000",
        ink: "#FFFFFF",
        "ink-secondary": "#D4D4D8",
        "ink-muted": "#A1A1AA",
        accent: "#00D9FF",
        "line-faint": "#404040",
        "line-strong": "#404040",
        "surface-raised": "#1A1A1A",
      },
      boxShadow: {
        // ENFORCE DESIGN.MD: 4-Layer persona-weighted shadow stacks
        "cyan-glow": "0 2px 4px rgba(0, 217, 255, 0.25), 0 4px 8px rgba(0, 217, 255, 0.15), 0 8px 16px rgba(0, 217, 255, 0.1), 0 12px 32px rgba(0, 217, 255, 0.05)",
        "white-subtle": "0 1px 3px rgba(255, 255, 255, 0.1), 0 2px 6px rgba(255, 255, 255, 0.08), 0 4px 12px rgba(255, 255, 255, 0.05), 0 8px 24px rgba(255, 255, 255, 0.02)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      keyframes: {
        slideInDown: {
          from: { opacity: "0", transform: "translateY(-12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        slideInDown: "slideInDown 0.3s ease-out forwards",
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    plugin(function({ addUtilities }) {
      addUtilities({
        // ENFORCE DESIGN.MD: Recursive tessellation utilities
        '.clip-tessellate': {
          'clip-path': 'polygon(0 0, 100% 0, 100% 80%, 80% 100%, 0 100%)',
        },
        '.clip-tessellate-reverse': {
          'clip-path': 'polygon(0 20%, 100% 0, 100% 100%, 0 100%)',
        }
      })
    })
  ],
}

export default config;
