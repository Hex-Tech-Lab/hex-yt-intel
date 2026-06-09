import React, { useEffect, useState } from "react";

/* ============================================================================
   THEME CONTEXT & HOOK
   Manages light/dark theme with localStorage persistence.
   Zero internal state in components; theme passed as prop.
   ========================================================================= */

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Hydrate from localStorage
    const stored = localStorage.getItem("hex-yt-theme") as Theme | null;
    const systemPreference = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    const initial = stored || systemPreference;

    setThemeState(initial);
    document.documentElement.setAttribute("data-theme", initial);
    setMounted(true);
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("hex-yt-theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  if (!mounted) return children; // Avoid hydration mismatch

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

/* ============================================================================
   THEME TOGGLE BUTTON
   Stateless; theme passed as prop, setTheme called on click.
   ========================================================================= */

interface ThemeToggleProps {
  theme: "light" | "dark";
  onToggle: (theme: "light" | "dark") => void;
  style?: React.CSSProperties;
}

export function ThemeToggle({ theme, onToggle, style = {} }: ThemeToggleProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: 4,
        background: "transparent",
        ...style,
      }}
    >
      <button
        type="button"
        onClick={() => onToggle("dark")}
        aria-pressed={theme === "dark"}
        title="Dark theme"
        style={{
          padding: "6px 10px",
          borderRadius: 4,
          border: "none",
          background: theme === "dark" ? "var(--accent-strong)" : "transparent",
          color: theme === "dark" ? "var(--void)" : "var(--ink-secondary)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          transition: "all var(--dur-fast)",
        }}
      >
        🌙 Dark
      </button>
      <button
        type="button"
        onClick={() => onToggle("light")}
        aria-pressed={theme === "light"}
        title="Light theme"
        style={{
          padding: "6px 10px",
          borderRadius: 4,
          border: "none",
          background: theme === "light" ? "var(--accent-strong)" : "transparent",
          color: theme === "light" ? "var(--void)" : "var(--ink-secondary)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          transition: "all var(--dur-fast)",
        }}
      >
        ☀️ Light
      </button>
    </div>
  );
}
