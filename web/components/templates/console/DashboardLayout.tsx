'use client';

import { ReactNode, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useUIStore } from '@/store/useUIStore';

// See /docs/ui/dashboard-layout.md

export interface DashboardLayoutProps {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
  rightPanel?: ReactNode;
  dock?: ReactNode;
}

export function DashboardLayout({ sidebar, topbar, children, rightPanel, dock }: DashboardLayoutProps) {
  const isAnyOverlayOpen = useUIStore((s) => s.isAnyOverlayOpen);
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const mobileRightOpen = useUIStore((s) => s.mobileRightOpen);
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const setMobileRight = useUIStore((s) => s.setMobileRight);
  const pathname = usePathname();

  // Auto-close the mobile drawers whenever the route changes.
  useEffect(() => {
    setMobileNav(false);
    setMobileRight(false);
  }, [pathname, setMobileNav, setMobileRight]);

  const anyDrawerOpen = mobileNavOpen || mobileRightOpen;

  // Lock body scroll on iOS Safari when off-canvas drawers are open
  useEffect(() => {
    if (anyDrawerOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    } else {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, [anyDrawerOpen]);

  // Shared drawer chrome: off-canvas + slide on mobile/tablet, static grid column on lg+.
  const drawerBase =
    // touch-action is CSS-inherited: body gets touch-action:none while a
    // drawer is open (below), which would otherwise compute through to the
    // drawer's own scrollable content and block touch-scrolling inside the
    // very drawer it's meant to keep usable. pan-y explicitly re-enables
    // vertical touch scroll for this element regardless of the body's value.
    'overflow-y-auto flex flex-col rounded-xl border border-[var(--line)] [touch-action:pan-y] [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch] [transform:translateZ(0)] [-webkit-transform:translateZ(0)] ' +
    'fixed inset-y-1 z-50 w-[300px] max-w-[86vw] shadow-2xl transition-transform duration-300 ease-out ' +
    'xl:static xl:inset-auto xl:z-auto xl:w-full xl:max-w-none xl:h-full xl:shadow-none xl:translate-x-0 xl:transition-none';

  return (
    <div className={`grid h-[100dvh] xl:h-screen w-full max-w-full bg-[var(--void)] text-[var(--ink)] overflow-x-hidden xl:overflow-hidden gap-1 p-1 sm:p-1.5 grid-cols-1 ${
      rightPanel ? "xl:grid-cols-[260px_1fr_390px]" : "xl:grid-cols-[260px_1fr]"
    }`}>
      {/* Mobile drawer backdrop */}
      {anyDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm xl:hidden"
          onClick={() => { setMobileNav(false); setMobileRight(false); }}
          aria-hidden
        />
      )}

      {/* Left sidebar — hamburger drawer on mobile, static column on desktop */}
      <aside
        inert={isAnyOverlayOpen ? true : undefined}
        className={`${drawerBase} left-1 bg-[var(--void)] xl:left-auto ${mobileNavOpen ? 'translate-x-0' : '-translate-x-[calc(100%+0.5rem)]'}`}
      >
        {sidebar}
      </aside>

      <main
        inert={isAnyOverlayOpen ? true : undefined}
        className="relative flex flex-col h-[calc(100dvh-0.5rem)] sm:h-[calc(100dvh-0.75rem)] xl:h-full min-w-0 overflow-hidden bg-[var(--bg)] border border-[var(--line)] rounded-xl [transform:translateZ(0)] [-webkit-transform:translateZ(0)]"
      >
        <header className="border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.8)] backdrop-blur-md z-20 flex-shrink-0">
          {topbar}
        </header>

        <div className="flex-1 overflow-y-auto px-1.5 py-1.5 sm:px-2 sm:py-2 xl:px-2.5 xl:py-2 scroll-smooth [-webkit-overflow-scrolling:touch] [overscroll-behavior-y:contain]">
          <div className="max-w-[1200px] mx-auto min-h-full flex flex-col">
            <div className="flex-1 min-w-0">
              {children}
            </div>
          </div>
        </div>

        {dock}
      </main>

      {rightPanel && (
        <aside
          inert={isAnyOverlayOpen ? true : undefined}
          className={`${drawerBase} right-1 bg-[var(--surface)] p-1.5 px-2 xl:right-auto ${mobileRightOpen ? 'translate-x-0' : 'translate-x-[calc(100%+0.5rem)]'}`}
        >
          {rightPanel}
        </aside>
      )}
    </div>
  );
}
