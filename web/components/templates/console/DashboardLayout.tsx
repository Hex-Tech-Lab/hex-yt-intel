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

  // Shared drawer chrome: off-canvas + slide on mobile, static grid column on lg+.
  const drawerBase =
    'overflow-y-auto flex flex-col rounded-xl border border-[var(--line)] ' +
    'fixed inset-y-2 z-50 w-[300px] max-w-[86vw] shadow-2xl transition-transform duration-300 ease-out ' +
    'xl:static xl:inset-auto xl:z-auto xl:w-full xl:max-w-none xl:h-full xl:shadow-none xl:translate-x-0 xl:transition-none';

  return (
    <div className={`grid min-h-[100dvh] xl:h-screen w-full max-w-full bg-[var(--void)] text-[var(--ink)] overflow-x-hidden xl:overflow-hidden gap-2 p-2 sm:p-3 grid-cols-1 ${
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
        className={`${drawerBase} left-2 bg-[var(--void)] xl:left-auto ${mobileNavOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1rem)]'}`}
      >
        {sidebar}
      </aside>

      <main
        inert={isAnyOverlayOpen ? true : undefined}
        className="relative flex flex-col h-auto xl:h-full min-w-0 min-h-[calc(100vh-1rem)] xl:min-h-0 overflow-hidden bg-[var(--bg)] border border-[var(--line)] rounded-xl"
      >
        <header className="border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.8)] backdrop-blur-md z-20">
          {topbar}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 xl:px-8 xl:py-6 scroll-smooth">
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
          className={`${drawerBase} right-2 bg-[var(--surface)] p-3 px-4 xl:right-auto ${mobileRightOpen ? 'translate-x-0' : 'translate-x-[calc(100%+1rem)]'}`}
        >
          {rightPanel}
        </aside>
      )}
    </div>
  );
}
