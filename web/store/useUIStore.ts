import { create } from 'zustand';

interface UIState {
  isAnyOverlayOpen: boolean;
  activeOverlayId: string | null;
  setOverlayOpen: (isOpen: boolean, id?: string | null) => void;
}

/**
 * Global UI Store
 * Manages UI-only state like modal/drawer visibility to coordinate
 * accessibility features like the 'inert' attribute.
 */
export const useUIStore = create<UIState>((set) => ({
  isAnyOverlayOpen: false,
  activeOverlayId: null,
  setOverlayOpen: (isOpen, id = null) => set({ 
    isAnyOverlayOpen: isOpen, 
    activeOverlayId: isOpen ? id : null 
  }),
}));
