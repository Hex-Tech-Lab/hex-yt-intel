import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#06B6D4",
        surface: "#1A1F2B",
        accent: "#06B6D4",
        border: {
          DEFAULT: "#252A38",
        },
        "text-primary": "#111827",
        "text-secondary": "#4B5563",
      },
      borderRadius: {
        card: "16px",
        control: "8px",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      keyframes: {
        flare: {
          "0%": { boxShadow: "0 0 0 1px rgba(6, 182, 212, 0.2)" },
          "50%": { boxShadow: "0 0 0 3px rgba(6, 182, 212, 0.4)" },
          "100%": { boxShadow: "0 0 0 1px rgba(6, 182, 212, 0.2)" },
        },
        slideInDown: {
          from: { opacity: "0", transform: "translateY(-12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        flare: "flare 2s ease-in-out infinite",
        slideInDown: "slideInDown 0.3s ease-out forwards",
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}

export default config
