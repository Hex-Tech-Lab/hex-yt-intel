'use client';

import { ReactNode } from 'react';
import { useUIStore } from '@/store/useUIStore';
import { MobileMenu } from './MobileMenu';
import type { User } from '@supabase/supabase-js';

/**
 * MobileDrawerContainer Component
 *
 * Manages the mobile menu drawer overlay and backdrop.
 * Provides:
 * - Smooth slide-in animation
 * - Touch backdrop for closing
 * - Proper z-index stacking
 * - Accessibility features (inert, aria-hidden)
 *
 * Usage: Wrap your page content with this component
 * It will render the mobile menu drawer on top when active
 */
interface MobileDrawerContainerProps {
  children: ReactNode;
  user?: User | null;
}

export function MobileDrawerContainer({ children, user }: MobileDrawerContainerProps) {
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const isAnyOverlayOpen = useUIStore((s) => s.isAnyOverlayOpen);

  return (
    <>
      {/* Main Content */}
      {children}

      {/* Mobile Menu Drawer */}
      {mobileNavOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm xl:hidden"
            onClick={() => setMobileNav(false)}
            aria-hidden="true"
          />

          {/* Drawer Container */}
          <div
            role="navigation"
            aria-label="Mobile navigation menu"
            className="fixed inset-y-0 left-0 z-50 w-[320px] max-w-[90vw] h-screen overflow-hidden bg-[var(--void)] shadow-2xl transition-transform duration-300 ease-out animate-slideInDown xl:hidden"
            inert={isAnyOverlayOpen ? true : undefined}
          >
            <MobileMenu user={user} />
          </div>
        </>
      )}
    </>
  );
}
