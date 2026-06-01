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
    },
  },
  plugins: [],
}

export default config
