import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ConsoleViewState {
  viewMode: "simple" | "pro";
  setViewMode: (mode: "simple" | "pro") => void;
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
