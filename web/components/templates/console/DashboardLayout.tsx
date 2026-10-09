'use client';

import { ReactNode, useEffect, useRef } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { usePathname } from 'next/navigation';
import { useUIStore } from '@/store/useUIStore';
import {
  DEFAULT_LAYOUT,
  registerResetSink,
  useDashboardPanels,
  type LayoutShape,
} from '@/lib/hooks/useDashboardLayout';

// See /docs/ui/dashboard-layout.md

export interface DashboardLayoutProps {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
  rightPanel?: ReactNode;
  dock?: ReactNode;
}

// WheelEvent deltas aren't always CSS pixels -- deltaMode distinguishes
// pixel (0), line (1), and page (2) units, and some mice/browsers emit
// line-mode deltas by default (Cubic review, PR #221). Normalize to
// pixels before forwarding, using a standard 16px line height for line
// mode and the scroll container's own viewport size for page mode.
// Module-level, not component-local: takes all its inputs as parameters
// and closes over nothing component-specific, so defining it inside
// DashboardLayout recreated the function on every render for no reason
// (react-best-practices review, 2026-08-08).
function normalizeWheelDelta(delta: number, deltaMode: number, viewportSize: number): number {
  if (deltaMode === 1) return delta * 16; // DOM_DELTA_LINE
  if (deltaMode === 2) return delta * viewportSize; // DOM_DELTA_PAGE
  return delta; // DOM_DELTA_PIXEL
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

  // Close on Escape -- web-design-guidelines audit, 2026-08-08: the backdrop
  // closes drawers on click but is aria-hidden (correctly unreachable via
  // Tab), so keyboard-only users had NO way to close a mobile drawer at all
  // before this. Standard modal/drawer dismissal keyboard affordance.
  useEffect(() => {
    if (!anyDrawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNav(false);
        setMobileRight(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyDrawerOpen, setMobileNav, setMobileRight]);

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

  // Resizable desktop panels (xl+ only). `shape` keys the per-shape
  // localStorage layout (2-column vs 3-column -- rightPanel is optional,
  // and mixing percentages across different panel counts would collide).
  const shape: LayoutShape = rightPanel ? '3col' : '2col';
  const { isDesktop, sidebarSize, rightSize, handleLayoutChanged } =
    useDashboardPanels(shape);
  // Group layout in PERCENTAGES (Group's defaultLayout). Center takes the
  // remainder so the panels always sum to 100. Per-panel defaultSize is not
  // used: react-resizable-panels v4 reads a bare number as pixels, and a
  // defaultSize that is not part of a Group defaultLayout did not apply.
  const sidebarPct = sidebarSize ?? DEFAULT_LAYOUT[shape].sidebar;
  const rightPct = shape === '3col' ? (rightSize ?? DEFAULT_LAYOUT[shape].right) : 0;
  const centerPct = 100 - sidebarPct - rightPct;
  const groupLayout: Record<string, number> =
    shape === '3col'
      ? { sidebar: sidebarPct, center: centerPct, right: rightPct }
      : { sidebar: sidebarPct, center: centerPct };

  const groupRef = useGroupRef();

  // Register the imperative reset bridge: Reset Layout snaps the live
  // Group back to its DEFAULT_LAYOUT percentages (via setLayout) without a
  // reload. Registered only while the
  // desktop panel group is actually mounted.
  useEffect(() => {
    if (!isDesktop) return;
    registerResetSink(() => {
      // setLayout requires a complete layout (all panel ids) and validates
      // percentages sum to ~100: center absorbs the remainder, derived from
      // DEFAULT_LAYOUT so the reset target and the hydrated defaults share
      // one source of truth.
      const { sidebar, right } = DEFAULT_LAYOUT[shape];
      groupRef.current?.setLayout(
        shape === '3col'
          ? { sidebar, center: 100 - sidebar - right, right }
          : { sidebar, center: 100 - sidebar }
      );
    });
    return () => registerResetSink(null);
  }, [isDesktop, shape, groupRef]);

  const onGroupLayoutChanged = handleLayoutChanged;

  // Drag handle chrome: Tailwind-only (frozen stack, no imported CSS).
  // The hairline bar is painted by ::before on a wide hit area so the
  // grab target stays comfortable while the visible affordance stays
  // thin. The library exposes drag state via data-separator-overlay /
  // data-state on the Group; hover/active accent handled with plain
  // Tailwind utilities on the wrapper's children via group selectors.
  const separatorClass =
    'group/sep relative flex w-[9px] shrink-0 cursor-col-resize items-center justify-center outline-none ' +
    'before:h-full before:w-px before:bg-[var(--line)] before:transition-colors before:duration-150 ' +
    'group-hover/sep:before:bg-[var(--ink-muted)] focus-visible:before:bg-[var(--accent)] ' +
    'data-[resize-active]:before:bg-[var(--accent)]';

  const showDesktopPanels = isDesktop;

  return (
    <div
      className={`grid h-[100dvh] xl:h-screen w-full max-w-full bg-[var(--void)] text-[var(--ink)] overflow-x-hidden xl:overflow-hidden gap-1 p-1 sm:p-1.5 grid-cols-1 ${
        showDesktopPanels ? '' : rightPanel ? 'xl:grid-cols-[260px_1fr_390px]' : 'xl:grid-cols-[260px_1fr]'
      }`}
    >
      {/* Mobile drawer backdrop */}
      {anyDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm xl:hidden"
          onClick={() => { setMobileNav(false); setMobileRight(false); }}
          onWheel={(wheelEvent) => {
            const target = mainScrollRef.current;
            if (!target) return;
            // 'instant' (not the container's own scroll-smooth CSS) so
            // rapid trackpad/wheel events apply immediately instead of
            // each one queuing/extending a smooth-scroll animation
            // (Cubic review, PR #221).
            target.scrollBy({
              top: normalizeWheelDelta(wheelEvent.deltaY, wheelEvent.deltaMode, target.clientHeight),
              left: normalizeWheelDelta(wheelEvent.deltaX, wheelEvent.deltaMode, target.clientWidth),
              behavior: 'instant',
            });
          }}
          aria-hidden
        />
      )}

      {showDesktopPanels ? (
        <Group
          groupRef={groupRef}
          id={`console-dashboard-${shape}`}
          orientation="horizontal"
          defaultLayout={groupLayout}
          onLayoutChanged={onGroupLayoutChanged}
          className="col-span-full flex h-full min-h-0 gap-1 p-1 sm:p-1.5"
        >
          <Panel
            id="sidebar"
            minSize="10%"
            maxSize="30%"
            className="min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--void)]"
          >
            <div
              inert={isAnyOverlayOpen ? true : undefined}
              className="h-full overflow-y-auto"
            >
              {sidebar}
            </div>
          </Panel>

          <Separator className={separatorClass} aria-label="Resize sidebar" />

          <Panel id="center" className="min-w-0">
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
              className="relative flex h-full flex-col overflow-hidden bg-[var(--bg)] border border-[var(--line)] rounded-xl [transform:translateZ(0)] [-webkit-transform:translateZ(0)]"
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
          </Panel>

          {shape === '3col' && (
            <>
              <Separator className={separatorClass} aria-label="Resize intelligence panel" />
              <Panel
                id="right"
                minSize="10%"
                maxSize="35%"
                className="min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 px-2"
              >
                <div
                  inert={isAnyOverlayOpen ? true : undefined}
                  className="h-full overflow-y-auto"
                >
                  {rightPanel}
                </div>
              </Panel>
            </>
          )}
        </Group>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
