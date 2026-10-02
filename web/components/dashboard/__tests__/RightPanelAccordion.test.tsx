/**
 * The Word Cloud is always in the right panel now (like Pro's other panels):
 * collapsed while there is nothing to show, opening by itself when its
 * defaultOpen flips false -> true (an analysis starts). Otherwise the
 * viewer's own open/close choice is kept.
 */

// @vitest-environment happy-dom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { RightPanelAccordion } from '@/components/dashboard/RightPanelAccordion';

const item = (defaultOpen: boolean) => [{ id: 'word-cloud', title: 'Word Cloud', defaultOpen, content: () => <p>cloud body</p> }];

describe('RightPanelAccordion defaultOpen rising edge', () => {
  afterEach(cleanup);

  it('stays collapsed while defaultOpen is false, opens when it flips to true', () => {
    const { rerender } = render(<RightPanelAccordion items={item(false)} />);
    expect(screen.getByText('Word Cloud')).not.toBeNull();
    expect(screen.queryByText('cloud body')).toBeNull();
    rerender(<RightPanelAccordion items={item(true)} />);
    expect(screen.getByText('cloud body')).not.toBeNull();
  });

  it('a manual close sticks while defaultOpen stays true', async () => {
    const { rerender } = render(<RightPanelAccordion items={item(true)} />);
    expect(screen.getByText('cloud body')).not.toBeNull();
    act(() => screen.getByText('Word Cloud').click());
    await waitFor(() => expect(screen.queryByText('cloud body')).toBeNull());
    rerender(<RightPanelAccordion items={item(true)} />);
    expect(screen.queryByText('cloud body')).toBeNull();
  });
});
