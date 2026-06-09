import type { Config } from "tailwindcss"
import { hexYtIntelConfig } from "../design-system/tailwind-config-extensions"

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // We deep merge our centralized config
    ...hexYtIntelConfig.theme,
    extend: {
      ...hexYtIntelConfig.theme.extend,
      // Any web-specific overrides can go here
    }
  },
  plugins: [
    require('@tailwindcss/typography'),
    ...hexYtIntelConfig.plugins
  ],
}

export default config
