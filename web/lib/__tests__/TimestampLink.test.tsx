// @vitest-environment happy-dom
//
// This test file renders real components via @testing-library/react but was
// silently never executed by CI at all (see vitest.config.ts's include glob
// fix, 2026-08-08 retro review of PR #212) -- the missing environment
// pragma below was never caught because the file never ran. Added now that
// the glob fix makes it actually run under the workspace's default `node`
// environment, matching the pattern already used by every other RTL test
// in this repo (see hooks/__tests__/*.test.tsx, components/.../WordCloud.test.tsx).
import { render, screen, fireEvent } from '@testing-library/react';
import { TimestampLink } from '@/components/TimestampLink';
import { useVideoStore } from '@/store/useVideoStore';
import { expect, describe, it, beforeEach, vi } from 'vitest';

/**
 * Unit tests for TimestampLink component
 * Tests timestamp parsing, store interaction, and accessibility
 */
describe('TimestampLink', () => {
  beforeEach(() => {
    // Reset the store before each test
    useVideoStore.setState({
      isPlaying: false,
      seekTo: null,
    });
  });

  describe('Timestamp Parsing', () => {
    it('should parse HH:MM:SS format correctly', () => {
      const { container } = render(<TimestampLink timestamp="01:30:45" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) fireEvent.click(link);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(5445); // 1*3600 + 30*60 + 45
    });

    it('should parse MM:SS format correctly', () => {
      const { container } = render(<TimestampLink timestamp="02:30" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) fireEvent.click(link);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(150); // 2*60 + 30
    });

    it('should parse raw seconds format correctly', () => {
      const { container } = render(<TimestampLink timestamp="45" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) fireEvent.click(link);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(45);
    });

    it('should handle zero timestamp', () => {
      const { container } = render(<TimestampLink timestamp="00:00:00" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) fireEvent.click(link);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(0);
    });

    it('should handle invalid timestamp gracefully', () => {
      const { container } = render(<TimestampLink timestamp="invalid" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) fireEvent.click(link);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(0);
    });
  });

  describe('Click Handling', () => {
    it('should trigger setSeekTo on click', () => {
      const { container } = render(<TimestampLink timestamp="01:23" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) {
        fireEvent.click(link);
        const state = useVideoStore.getState();
        expect(state.seekTo).toBe(83); // 1*60 + 23
      }
    });

    it('should prevent default link behavior', () => {
      // fireEvent.click(el, eventProperties) does NOT dispatch the passed
      // Event instance itself -- Testing Library only reads it as an
      // EventInit and constructs its own event, so spying on a MouseEvent
      // built separately and handed to fireEvent as the second arg can
      // never observe the handler's calls (stale assertion, found in the
      // 2026-08-08 retro review of PR #212 -- this file was silently never
      // executed by CI before that pass, so this bug in the test itself was
      // never caught). Dispatch the spied event directly on the element
      // instead, matching how the browser actually delivers it to the
      // handler.
      const { container } = render(<TimestampLink timestamp="01:23" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

        link.dispatchEvent(event);
        expect(preventDefaultSpy).toHaveBeenCalled();
      }
    });

    it('should stop event propagation on click', () => {
      const { container } = render(<TimestampLink timestamp="01:23" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

        link.dispatchEvent(event);
        expect(stopPropagationSpy).toHaveBeenCalled();
      }
    });
  });

  describe('Keyboard Handling', () => {
    it('should trigger setSeekTo on Enter key', () => {
      const { container } = render(<TimestampLink timestamp="00:30" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) {
        fireEvent.keyDown(link, { key: 'Enter' });
        const state = useVideoStore.getState();
        expect(state.seekTo).toBe(30);
      }
    });

    it('should trigger setSeekTo on Space key', () => {
      const { container } = render(<TimestampLink timestamp="00:30" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) {
        fireEvent.keyDown(link, { key: ' ' });
        const state = useVideoStore.getState();
        expect(state.seekTo).toBe(30);
      }
    });

    it('should not trigger on other keys', () => {
      const { container } = render(<TimestampLink timestamp="00:30" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) {
        useVideoStore.setState({ seekTo: null });
        fireEvent.keyDown(link, { key: 'a' });

        const state = useVideoStore.getState();
        expect(state.seekTo).toBeNull();
      }
    });
  });

  describe('Rendering', () => {
    it('should render with default children (timestamp + icon)', () => {
      // Astryx's Link renders a real <a>, whose accessible role is "link"
      // -- "button" was a stale assertion (found in the 2026-08-08 retro
      // review of PR #212, see vitest.config.ts history for why this file
      // was never actually executed by CI until then).
      render(<TimestampLink timestamp="01:30" />);
      const link = screen.getByRole('link', { name: /seek to 01:30/i });
      expect(link).toBeInTheDocument();
      expect(link.textContent).toContain('01:30');
    });

    it('should render with custom children', () => {
      render(<TimestampLink timestamp="01:30">Custom Label</TimestampLink>);
      expect(screen.getByText('Custom Label')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <TimestampLink timestamp="01:30" className="custom-class" />
      );
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) {
        expect(link.className).toContain('custom-class');
      }
    });

    it('should have proper accessibility attributes', () => {
      render(<TimestampLink timestamp="01:30" />);
      const link = screen.getByRole('link', { name: /seek to 01:30/i });

      // A native <a href="..."> is keyboard-focusable by default -- no
      // explicit tabIndex is rendered (or needed). Astryx's Link renders
      // its tooltip as a real popover element (role="tooltip", linked via
      // aria-describedby) rather than a native `title` attribute -- both
      // were stale assertions (found in the 2026-08-08 retro review of
      // PR #212, see the file header for why this file was never actually
      // executed by CI before that pass).
      expect(link).toHaveAttribute('aria-label', 'Seek to 01:30');
      // Cubic review (PR #219): asserting aria-describedby merely EXISTS,
      // and separately that A tooltip with the right text exists somewhere
      // in the document, doesn't prove they're the SAME element -- a
      // dangling or wrong-target aria-describedby would still pass. Assert
      // the actual ID relationship: the tooltip getByRole finds must be the
      // exact element aria-describedby points to.
      const describedbyId = link.getAttribute('aria-describedby');
      expect(describedbyId).toBeTruthy();
      const tooltip = screen.getByRole('tooltip', { hidden: true });
      expect(tooltip).toHaveAttribute('id', describedbyId);
      expect(tooltip).toHaveTextContent('Seek to 01:30');
    });
  });

  describe('Store Integration', () => {
    it('should update store seekTo value', () => {
      const { container } = render(<TimestampLink timestamp="02:45" />);

      // Initially null
      expect(useVideoStore.getState().seekTo).toBeNull();

      // Click to trigger seek
      const link = container.querySelector('a');
      if (link) fireEvent.click(link);

      // Should be updated
      expect(useVideoStore.getState().seekTo).toBe(165); // 2*60 + 45
    });

    it('should handle multiple consecutive clicks', () => {
      const { container } = render(<TimestampLink timestamp="01:00" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      if (link) {
        fireEvent.click(link);
        expect(useVideoStore.getState().seekTo).toBe(60);

        fireEvent.click(link);
        expect(useVideoStore.getState().seekTo).toBe(60);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long timestamps', () => {
      const { container } = render(<TimestampLink timestamp="10:30:45" />);
      const link = container.querySelector('a');
      if (link) fireEvent.click(link);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(37845); // 10*3600 + 30*60 + 45
    });

    it('should handle single digit timestamps', () => {
      const { container } = render(<TimestampLink timestamp="5" />);
      const link = container.querySelector('a');
      if (link) fireEvent.click(link);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(5);
    });
  });
});
