'use client';

import { ReactNode, useEffect, useRef } from 'react';
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
  // The mobile/tablet drawer backdrop below is a full-screen `fixed
  // inset-0` div sitting above <main> in stacking order (z-40) purely to
  // catch "click outside to close" -- but that also makes it the topmost
  // hit-target for wheel/trackpad scroll events everywhere on screen,
  // silently blocking scroll over main while a drawer is open below the
  // xl breakpoint (1280px). The 2026-08-07 fix only removed `inert` (which
  // blocked iOS touch-scroll specifically) and never covered this separate
  // wheel-event-interception issue, live-reported 2026-08-08 at a viewport
  // pinned under 1280px by an open devtools panel. Forward wheel deltas
  // from the backdrop to main's actual scroll container instead of
  // removing the backdrop (still needed for click-to-close and dimming).
  const mainScrollRef = useRef<HTMLDivElement>(null);

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
          onWheel={(wheelEvent) => { mainScrollRef.current?.scrollBy({ top: wheelEvent.deltaY, left: wheelEvent.deltaX }); }}
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
        // Deliberately NOT inert'd, on any breakpoint: the backdrop below
        // (bg-black/60, z-40, its own click-to-close handler) already blocks
        // accidental interaction with main while a drawer/dimension overlay
        // is open -- inert additionally froze all touch-scroll and video
        // playback inside main, which on iOS/iPadOS Safari specifically
        // reads as "scroll is stuck" (user-confirmed direction 2026-08-07:
        // keep main scrollable everywhere, backdrop alone is enough -- match
        // the desktop/wide-viewport experience, where main was never inert'd
        // in the first place, on every breakpoint including the "stacked"
        // one this used to gate on).
        className="relative flex flex-col h-[calc(100dvh-0.5rem)] sm:h-[calc(100dvh-0.75rem)] xl:h-full min-w-0 overflow-hidden bg-[var(--bg)] border border-[var(--line)] rounded-xl [transform:translateZ(0)] [-webkit-transform:translateZ(0)]"
      >
        <header className="border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.8)] backdrop-blur-md z-20 flex-shrink-0">
          {topbar}
        </header>

        <div
          ref={mainScrollRef}
          className="flex-1 overflow-y-auto px-1.5 py-1.5 sm:px-2 sm:py-2 xl:px-2.5 xl:py-2 scroll-smooth [-webkit-overflow-scrolling:touch] [overscroll-behavior-y:contain]"
        >
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
