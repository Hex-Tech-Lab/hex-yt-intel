/**
 * INP T7 regression: <Icon> is rendered once per list row / message action.
 * Before the memo() wrapper, every parent re-render (for example a streaming
 * chat token) re-rendered every icon SVG even with unchanged props.
 *
 * Counts renders by mocking the offline Iconify renderer. Negative control:
 * remove memo() from Icon in primitives.tsx and this test fails (renders go
 * from 40 to 160).
 */

// @vitest-environment happy-dom

import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const renderCount = vi.hoisted(() => ({ n: 0 }));

vi.mock('@iconify/react/offline', () => ({
  Icon: () => {
    renderCount.n += 1;
    return null;
  },
  addCollection: () => undefined,
}));

// The real Tooltip/Astryx module is not needed for Icon; stub it to keep the
// test isolated from the design-system bundle.
vi.mock('@astryxdesign/core', () => ({ Tooltip: ({ children }: { children: unknown }) => children }));

// solar-subset.json import is only used to register icons; stub it out.
vi.mock('@/lib/icons/solar-subset.json', () => ({ default: { prefix: 'solar', icons: {} } }));

import { Icon } from '@/components/templates/_shared/primitives';

const ROWS = 40;

function IconList() {
  return (
    <div>
      {Array.from({ length: ROWS }, (unusedItem, rowIndex) => (
        <Icon key={rowIndex} icon="solar:copy-linear" size={13} />
      ))}
    </div>
  );
}

// Parent that re-renders on demand with identical props, the way a streaming
// chat store update re-renders the message list.
let bump: () => void = () => undefined;
function Parent() {
  const [tick, setTick] = useState(0);
  bump = () => setTick((t) => t + 1);
  return <div data-tick={tick}><IconList /></div>;
}

describe('Icon render count (INP T7)', () => {
  afterEach(() => {
    cleanup();
    renderCount.n = 0;
  });

  it('does not re-render unchanged icons when the parent re-renders', () => {
    renderCount.n = 0;
    render(<Parent />);
    const afterMount = renderCount.n;
    expect(afterMount).toBe(ROWS);

    act(() => bump());
    act(() => bump());
    act(() => bump());

    // Three parent re-renders with identical icon props: memo() keeps the
    // count at the mount total instead of 4 * ROWS.
    expect(renderCount.n).toBe(afterMount);
  });
});
