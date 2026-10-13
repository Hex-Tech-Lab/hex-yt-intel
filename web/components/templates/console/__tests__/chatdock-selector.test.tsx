/** @vitest-environment jsdom */
/**
 * INP T7: ChatDock subscribes to 14 store fields via useShallow instead of the
 * whole chat store. Two properties must hold:
 *  1. a write to a field ChatDock does not read (loadingList, networkBound)
 *     must NOT re-render the message list;
 *  2. a streaming write (new messagesByConv object, growing content) MUST still
 *     update the visible assistant message.
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

  afterEach(() => cleanup());

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
});
