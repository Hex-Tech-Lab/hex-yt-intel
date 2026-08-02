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
  // Ownership-aware: this store has exactly one global "active overlay"
  // slot but multiple independent callers (DimensionDrawer,
  // ExpandedPanelOverlay) each open/close it with their own id. A
  // real bug (found in PR review, 2026-08-02): closing unconditionally
  // set isAnyOverlayOpen=false regardless of who called it, so if overlay
  // B opened while overlay A was still mounted, A's own unmount/close
  // cleanup would clobber B's still-open state -- B's `inert` protection
  // silently vanished while it was still on screen. Closing with an id
  // now only clears state if that id still owns the slot; closing with no
  // id (id === null, the default) always clears, matching prior behavior
  // for any caller that doesn't care about ownership.
  setOverlayOpen: (isOpen, id = null) => set((state) => {
    if (isOpen) return { isAnyOverlayOpen: true, activeOverlayId: id };
    if (id !== null && state.activeOverlayId !== id) return {};
    return { isAnyOverlayOpen: false, activeOverlayId: null };
  }),
  mobileNavOpen: false,
  mobileRightOpen: false,
  // Opening one mobile drawer closes the other so they never overlap.
  setMobileNav: (open) => set(open ? { mobileNavOpen: true, mobileRightOpen: false } : { mobileNavOpen: false }),
  setMobileRight: (open) => set(open ? { mobileRightOpen: true, mobileNavOpen: false } : { mobileRightOpen: false }),
}));
