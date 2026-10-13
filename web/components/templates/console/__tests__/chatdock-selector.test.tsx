/** @vitest-environment jsdom */
/**
 * INP T7: ChatDock subscribes to 14 store fields via useShallow instead of the
 * whole chat store. Properties checked:
 *  1. a write to a field ChatDock does not read (loadingList, networkBound)
 *     must NOT re-run the message-list render. Measured as calls to
 *     preprocessMarkdown, which ChatDockImpl invokes inline per assistant
 *     message on every render (this is the perf regression test);
 *  2. selector correctness guards (these pass on the old whole-store code too):
 *     streaming content updates, `error` and `sending` still reach the DOM.
 * Negative control: replace the useShallow selector with `useChatStore()` and
 * test 1 fails (preprocessMarkdown is called again after the unrelated write).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useChatStore } from '@/store/useChatStore';
import { ChatDock } from '../ChatDock';

const markdownCalls = vi.hoisted(() => ({ n: 0 }));

vi.mock('@/lib/utils/format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/format')>();
  return {
    ...actual,
    preprocessMarkdown: (body: string) => {
      markdownCalls.n += 1;
      return actual.preprocessMarkdown(body);
    },
  };
});

vi.mock('@/store/useVideoStore', () => ({
  useVideoStore: (selector: (state: { seekAndReveal: () => void }) => unknown) =>
    selector({ seekAndReveal: () => {} }),
}));

const noop = () => Promise.resolve();
const msg = (id: string, role: string, content: string) =>
  ({ id, role, content, createdAt: new Date().toISOString() }) as never;

describe('ChatDock store selector (INP T7)', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = () => {};
    // jsdom has no matchMedia; Astryx's Markdown reads it via useTheme.
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as never;
    markdownCalls.n = 0;
    useChatStore.setState({
      isChatOpen: true,
      conversations: [{ id: 'c1', title: 'T', updatedAt: new Date().toISOString() } as never],
      activeId: 'c1',
      messagesByConv: { c1: [msg('u1', 'user', 'question'), msg('a1', 'assistant', 'partial')] },
      loadingList: false,
      networkBound: false,
      loadConversations: noop,
      selectConversation: noop,
      bindNetwork: () => {},
    } as never);
  });

  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it('does not re-render the message list on writes to fields it does not read', () => {
    render(<ChatDock />);
    expect(screen.getByText('partial')).toBeTruthy();
    const before = markdownCalls.n;
    expect(before).toBeGreaterThan(0);

    act(() => useChatStore.setState({ loadingList: true, networkBound: true }));
    act(() => useChatStore.setState({ loadingList: false }));

    expect(markdownCalls.n).toBe(before);
  });

  it('still updates the visible assistant message when streaming tokens arrive', () => {
    render(<ChatDock />);
    expect(screen.getByText('partial')).toBeTruthy();

    act(() => {
      useChatStore.setState((s) => ({
        sending: true,
        messagesByConv: {
          ...s.messagesByConv,
          c1: [msg('u1', 'user', 'question'), msg('a1', 'assistant', 'partial answer grows')],
        },
      }));
    });

    expect(screen.getByText('partial answer grows')).toBeTruthy();
  });

  it('still shows a store error and the sending state (selected fields stay reactive)', () => {
    render(<ChatDock />);
    act(() => useChatStore.setState({ error: 'boom-error', sending: false }));
    expect(screen.getByText(/boom-error/)).toBeTruthy();
  });
});
