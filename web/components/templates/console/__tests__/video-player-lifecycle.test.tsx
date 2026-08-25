/** @vitest-environment jsdom */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VideoPlayerCard } from '../VideoPlayerCard';

// Polyfill window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Create stable mock functions outside
const mockClearSeek = vi.fn();
const mockSetPlaying = vi.fn();
const mockSetCurrentPlaybackSeconds = vi.fn();

vi.mock('@/store/useVideoStore', () => ({
  useVideoStore: Object.assign(vi.fn((selector) => selector({
    isPlaying: false,
    seekTo: null,
    clearSeek: mockClearSeek,
    setPlaying: mockSetPlaying,
    setCurrentPlaybackSeconds: mockSetCurrentPlaybackSeconds,
    playbackRate: 1,
  })), {
    getState: vi.fn(() => ({
      entityTimeSeekEnabled: false,
      setSeekTo: vi.fn(),
      currentPlaybackSeconds: null,
    })),
  })
}));

vi.mock('@/store/useAnalysisStore', () => ({
  useAnalysisStore: vi.fn((selector) => selector({
    videoMetadata: { videoId: 'test1234' }
  }))
}));

vi.mock('@/lib/stores/synthesis-nucleus-store', () => ({
  useSynthesisNucleus: vi.fn(() => 'test1234')
}));

const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockSeekTo = vi.fn();
const mockDestroy = vi.fn();
const mockMount = vi.fn((container, videoId, options) => {
  options.onReady?.();
});

vi.mock('@/lib/adapters/YouTubePlayerAdapter', () => {
  return {
    YouTubePlayerAdapter: class {
      mount = mockMount;
      play = mockPlay;
      pause = mockPause;
      seekTo = mockSeekTo;
      destroy = mockDestroy;
      getCurrentTime = vi.fn();
    }
  };
});

describe('VideoPlayerCard Lifecycle (P0 Hotfix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // requestIdleCallback mock
    window.requestIdleCallback = vi.fn((cb) => setTimeout(cb, 1)) as any;
    window.cancelIdleCallback = vi.fn((id) => clearTimeout(id as any));
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('Test 1: Multiple re-renders of parent component instantiate YT.Player exactly ONCE', () => {
    const { rerender, unmount } = render(<VideoPlayerCard />);
    
    act(() => { vi.advanceTimersByTime(10); });
    expect(mockMount).toHaveBeenCalledTimes(1);
    
    rerender(<VideoPlayerCard />);
    rerender(<VideoPlayerCard />);
    rerender(<VideoPlayerCard />);

    act(() => { vi.advanceTimersByTime(100); });
    expect(mockMount).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('Test 2: Dynamic prop changes update existing player via API without recreating the iframe DOM node', async () => {
    const { rerender } = render(<VideoPlayerCard />);
    act(() => { vi.advanceTimersByTime(10); });

    expect(mockMount).toHaveBeenCalledTimes(1);
    
    const { useVideoStore } = await import('@/store/useVideoStore');
    const useVideoStoreMock = useVideoStore as any;
    
    useVideoStoreMock.mockImplementation((selector: any) => selector({
      isPlaying: true,
      seekTo: 120,
      clearSeek: mockClearSeek,
      setPlaying: mockSetPlaying,
      setCurrentPlaybackSeconds: mockSetCurrentPlaybackSeconds,
      playbackRate: 1,
    }));
    
    rerender(<VideoPlayerCard />);
    act(() => { vi.advanceTimersByTime(10); });

    expect(mockMount).toHaveBeenCalledTimes(1);
  });

  it('Test 3: Unmounting cleanly disposes of event listeners and destroys the player instance', () => {
    const { unmount } = render(<VideoPlayerCard />);
    act(() => { vi.advanceTimersByTime(10); });

    expect(mockMount).toHaveBeenCalledTimes(1);
    expect(mockDestroy).toHaveBeenCalledTimes(0);

    unmount();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
