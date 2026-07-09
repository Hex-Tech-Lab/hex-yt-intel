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
      fireEvent.click(container.querySelector('a')!);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(5445); // 1*3600 + 30*60 + 45
    });

    it('should parse MM:SS format correctly', () => {
      const { container } = render(<TimestampLink timestamp="02:30" />);
      fireEvent.click(container.querySelector('a')!);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(150); // 2*60 + 30
    });

    it('should parse raw seconds format correctly', () => {
      const { container } = render(<TimestampLink timestamp="45" />);
      fireEvent.click(container.querySelector('a')!);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(45);
    });

    it('should handle zero timestamp', () => {
      const { container } = render(<TimestampLink timestamp="00:00:00" />);
      fireEvent.click(container.querySelector('a')!);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(0);
    });

    it('should handle invalid timestamp gracefully', () => {
      const { container } = render(<TimestampLink timestamp="invalid" />);
      fireEvent.click(container.querySelector('a')!);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(0);
    });
  });

  describe('Click Handling', () => {
    it('should trigger setSeekTo on click', () => {
      const { container } = render(<TimestampLink timestamp="01:23" />);
      const link = container.querySelector('a')!;

      fireEvent.click(link);
      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(83); // 1*60 + 23
    });

    it('should prevent default link behavior', () => {
      const { container } = render(<TimestampLink timestamp="01:23" />);
      const link = container.querySelector('a')!;

      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      fireEvent.click(link, event as any);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should stop event propagation on click', () => {
      const { container } = render(<TimestampLink timestamp="01:23" />);
      const link = container.querySelector('a')!;

      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

      fireEvent.click(link, event as any);
      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('Keyboard Handling', () => {
    it('should trigger setSeekTo on Enter key', () => {
      const { container } = render(<TimestampLink timestamp="00:30" />);
      const link = container.querySelector('a')!;

      fireEvent.keyDown(link, { key: 'Enter' });
      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(30);
    });

    it('should trigger setSeekTo on Space key', () => {
      const { container } = render(<TimestampLink timestamp="00:30" />);
      const link = container.querySelector('a')!;

      fireEvent.keyDown(link, { key: ' ' });
      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(30);
    });

    it('should not trigger on other keys', () => {
      const { container } = render(<TimestampLink timestamp="00:30" />);
      const link = container.querySelector('a')!;

      useVideoStore.setState({ seekTo: null });
      fireEvent.keyDown(link, { key: 'a' });

      const state = useVideoStore.getState();
      expect(state.seekTo).toBeNull();
    });
  });

  describe('Rendering', () => {
    it('should render with default children (timestamp + icon)', () => {
      render(<TimestampLink timestamp="01:30" />);
      const link = screen.getByRole('button', { name: /seek to 01:30/i });
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
      const link = container.querySelector('a')!;
      expect(link.className).toContain('custom-class');
    });

    it('should have proper accessibility attributes', () => {
      render(<TimestampLink timestamp="01:30" />);
      const link = screen.getByRole('button', { name: /seek to 01:30/i });

      expect(link).toHaveAttribute('tabIndex', '0');
      expect(link).toHaveAttribute('aria-label', 'Seek to 01:30');
      expect(link).toHaveAttribute('title', 'Seek to 01:30');
    });
  });

  describe('Store Integration', () => {
    it('should update store seekTo value', () => {
      const { container } = render(<TimestampLink timestamp="02:45" />);

      // Initially null
      expect(useVideoStore.getState().seekTo).toBeNull();

      // Click to trigger seek
      fireEvent.click(container.querySelector('a')!);

      // Should be updated
      expect(useVideoStore.getState().seekTo).toBe(165); // 2*60 + 45
    });

    it('should handle multiple consecutive clicks', () => {
      const { container } = render(<TimestampLink timestamp="01:00" />);
      const link = container.querySelector('a')!;

      fireEvent.click(link);
      expect(useVideoStore.getState().seekTo).toBe(60);

      fireEvent.click(link);
      expect(useVideoStore.getState().seekTo).toBe(60);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long timestamps', () => {
      const { container } = render(<TimestampLink timestamp="10:30:45" />);
      fireEvent.click(container.querySelector('a')!);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(37845); // 10*3600 + 30*60 + 45
    });

    it('should handle single digit timestamps', () => {
      const { container } = render(<TimestampLink timestamp="5" />);
      fireEvent.click(container.querySelector('a')!);

      const state = useVideoStore.getState();
      expect(state.seekTo).toBe(5);
    });
  });
});
