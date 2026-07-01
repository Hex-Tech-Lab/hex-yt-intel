import { create } from 'zustand';

interface UIState {
  isAnyOverlayOpen: boolean;
  activeOverlayId: string | null;
  setOverlayOpen: (isOpen: boolean, id?: string | null) => void;
  // Mobile off-canvas drawers (collapsed sidebar / right panel on small screens)
  mobileNavOpen: boolean;
  mobileRightOpen: boolean;
  setMobileNav: (open: boolean) => void;
  setMobileRight: (open: boolean) => void;
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
  mobileNavOpen: false,
  mobileRightOpen: false,
  // Opening one mobile drawer closes the other so they never overlap.
  setMobileNav: (open) => set(open ? { mobileNavOpen: true, mobileRightOpen: false } : { mobileNavOpen: false }),
  setMobileRight: (open) => set(open ? { mobileRightOpen: true, mobileNavOpen: false } : { mobileRightOpen: false }),
}));
