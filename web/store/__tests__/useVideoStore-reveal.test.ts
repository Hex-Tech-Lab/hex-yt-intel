import { describe, it, expect, beforeEach } from 'vitest';
import { useVideoStore } from '@/store/useVideoStore';

describe('useVideoStore – seekAndReveal (T15)', () => {
  beforeEach(() => useVideoStore.setState({ seekTo: null, revealRequest: 0, isPlaying: false }));

  it('seeks, plays and bumps revealRequest for a user click', () => {
    useVideoStore.getState().seekAndReveal(42);
    const state = useVideoStore.getState();
    expect(state.seekTo).toBe(42);
    expect(state.isPlaying).toBe(true);
    expect(state.revealRequest).toBe(1);
  });

  it('plain setSeekTo (highlights reel) never requests a scroll', () => {
    useVideoStore.getState().setSeekTo(10);
    expect(useVideoStore.getState().revealRequest).toBe(0);
  });
});
