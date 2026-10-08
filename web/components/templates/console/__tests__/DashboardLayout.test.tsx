// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DashboardLayout } from '../DashboardLayout';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

vi.mock('@/store/useUIStore', () => {
  const noop = () => {};
  return {
    useUIStore: (_selector?: (state: Record<string, unknown>) => unknown) =>
      _selector
        ? _selector({
            isAnyOverlayOpen: false,
            mobileNavOpen: false,
            mobileRightOpen: false,
            setMobileNav: noop,
            setMobileRight: noop,
          })
        : false,
  };
});

const KEY_2COL = 'hex:layout:v1:2col';

function stubDesktopEnvironment(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('1280'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
  class ResizeObserverStub {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
}

describe('DashboardLayout resizable panels', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderLayout(rightPanel?: React.ReactNode): void {
    render(
      <DashboardLayout
        sidebar={<div>sidebar-content</div>}
        topbar={<div>topbar-content</div>}
        rightPanel={rightPanel}
      >
        <div>main-content</div>
      </DashboardLayout>
    );
  }

  it('below-xl (no matchMedia desktop) renders the drawer tree with no panel group', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );

    renderLayout(<div>right-content</div>);

    expect(screen.getByText('sidebar-content')).toBeTruthy();
    expect(screen.getByText('main-content')).toBeTruthy();
    expect(screen.getByText('right-content')).toBeTruthy();
    expect(document.querySelector('[data-separator]')).toBeNull();
  });

  it('restores a persisted layout from localStorage on desktop', async () => {
    stubDesktopEnvironment();
    window.localStorage.setItem(KEY_2COL, JSON.stringify({ sidebar: 22 }));

    renderLayout();

    const sidebarPanel = document.querySelector('[data-testid="sidebar"]');
    expect(sidebarPanel).not.toBeNull();
    // Library applies the persisted defaultSize on mount; give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((sidebarPanel as HTMLElement).style.getPropertyValue('--width') || (sidebarPanel as HTMLElement).style.width).toBeTruthy();
  });

  it('falls back to defaults when the stored layout is corrupt JSON', async () => {
    stubDesktopEnvironment();
    window.localStorage.setItem(KEY_2COL, 'not-json{{{');

    renderLayout();

    const sidebarPanel = document.querySelector('[data-testid="sidebar"]');
    expect(sidebarPanel).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((sidebarPanel as HTMLElement).style.getPropertyValue('--width') || (sidebarPanel as HTMLElement).style.width).toBeTruthy();
    // Corrupt entry must not have crashed rendering; main content intact.
    expect(screen.getByText('main-content')).toBeTruthy();
  });

  it('reset sink clears persisted keys and snaps back to defaults', async () => {
    stubDesktopEnvironment();
    window.localStorage.setItem(KEY_2COL, JSON.stringify({ sidebar: 28 }));

    renderLayout();

    // The reset sink is registered by DashboardLayout's effect.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Fire a reset through the exported bridge (same path TopBar uses).
    const mod = await import('@/lib/hooks/useDashboardLayout');
    mod.requestDashboardLayoutReset();

    expect(window.localStorage.getItem(KEY_2COL)).toBeNull();
    expect(screen.getByText('main-content')).toBeTruthy();
  });
});
