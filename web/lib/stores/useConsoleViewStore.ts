import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ConsoleViewMode = "simple" | "pro";

interface ConsoleViewState {
  viewMode: ConsoleViewMode;
  setViewMode: (mode: ConsoleViewMode) => void;
}

export const useConsoleViewStore = create<ConsoleViewState>()(
  persist(
    (set) => ({
      viewMode: "simple",
      setViewMode: (mode) => set({ viewMode: mode }),
    }),
    {
      name: "hex-console-view-storage",
    },
  ),
);
