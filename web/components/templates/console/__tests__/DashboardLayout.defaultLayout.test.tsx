// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { DashboardLayout } from '../DashboardLayout';
import { requestDashboardLayoutReset } from '@/lib/hooks/useDashboardLayout';

// Captures the props every Group render receives, so the test can check the
// layout the Group mounted with (the library reads defaultLayout only at mount).
const { groupCalls, setLayout } = vi.hoisted(() => ({
  groupCalls: [] as Array<{ defaultLayout?: Record<string, number> }>,
  setLayout: vi.fn(),
}));

vi.mock('react-resizable-panels', () => ({
  Group: (props: { children?: ReactNode; defaultLayout?: Record<string, number> }) => {
    groupCalls.push({ defaultLayout: props.defaultLayout });
    return createElement('div', { 'data-group': '' }, props.children);
  },
  Panel: (props: { children?: ReactNode }) => createElement('div', null, props.children),
  Separator: () => createElement('div'),
  useGroupRef: () => ({ current: { setLayout } }),
}));

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
const KEY_3COL = 'hex:layout:v1:3col';

function stubDesktop(): void {
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
}

function renderThreeCol() {
  return render(
    <DashboardLayout
      sidebar={<div>sidebar-content</div>}
      topbar={<div>topbar</div>}
      rightPanel={<div>right-content</div>}
    >
      <div>main-content</div>
    </DashboardLayout>
  );
}

describe('DashboardLayout defaultLayout (percent, mount-time)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    groupCalls.length = 0;
    setLayout.mockClear();
    stubDesktop();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('3col with no saved layout mounts with 15/60/25 on the first Group render', () => {
    renderThreeCol();

    expect(groupCalls.length).toBeGreaterThan(0);
    expect(groupCalls[0].defaultLayout).toEqual({ sidebar: 15, center: 60, right: 25 });
  });

  it('3col restores a saved layout before the Group mounts (first render, not after)', () => {
    window.localStorage.setItem(KEY_3COL, JSON.stringify({ sidebar: 22, right: 20 }));

    renderThreeCol();

    expect(groupCalls[0].defaultLayout).toEqual({ sidebar: 22, center: 58, right: 20 });
  });

  it('2col restores a saved layout with no right key and center as remainder', () => {
    window.localStorage.setItem(KEY_2COL, JSON.stringify({ sidebar: 20 }));

    render(
      <DashboardLayout sidebar={<div>sidebar-content</div>} topbar={<div>topbar</div>}>
        <div>main-content</div>
      </DashboardLayout>
    );

    expect(groupCalls[0].defaultLayout).toEqual({ sidebar: 20, center: 80 });
    expect(groupCalls[0].defaultLayout).not.toHaveProperty('right');
  });

  it('a corrupt saved layout falls back to the 15/60/25 default', () => {
    window.localStorage.setItem(KEY_3COL, 'not-json{{{');

    renderThreeCol();

    expect(groupCalls[0].defaultLayout).toEqual({ sidebar: 15, center: 60, right: 25 });
  });

  it('Reset Layout snaps the live Group to 15/60/25 via setLayout', async () => {
    renderThreeCol();

    act(() => {
      requestDashboardLayoutReset();
    });

    expect(setLayout).toHaveBeenCalledWith({ sidebar: 15, center: 60, right: 25 });
  });
});
