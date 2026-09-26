import { describe, it, expect, vi } from 'vitest';
import { YouTubePlayerAdapter } from '../YouTubePlayerAdapter';

describe('YouTubePlayerAdapter Volume & Mute tracking (ADR 030)', () => {
  it('returns player volume clamped between 0 and 100', async () => {
    const adapter = new YouTubePlayerAdapter();
    const mockPlayer = {
      seekTo: vi.fn(),
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      destroy: vi.fn(),
      getCurrentTime: vi.fn().mockReturnValue(10),
      setPlaybackRate: vi.fn(),
      getVolume: vi.fn().mockReturnValue(75),
      isMuted: vi.fn().mockReturnValue(false),
    };

    (adapter as any).player = mockPlayer;

    expect(adapter.getVolume()).toBe(75);
    expect(adapter.isMuted()).toBe(false);

    // Test volume clamping and non-finite values
    mockPlayer.getVolume.mockReturnValue(150);
    expect(adapter.getVolume()).toBe(100);

    mockPlayer.getVolume.mockReturnValue(-20);
    expect(adapter.getVolume()).toBe(0);

    mockPlayer.getVolume.mockReturnValue(NaN);
    expect(adapter.getVolume()).toBe(100);

    mockPlayer.isMuted.mockReturnValue(true);
    expect(adapter.isMuted()).toBe(true);
  });

  it('fails safely when player throws or is destroyed', () => {
    const adapter = new YouTubePlayerAdapter();
    const mockPlayer = {
      seekTo: vi.fn(),
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      destroy: vi.fn(),
      getCurrentTime: vi.fn(),
      setPlaybackRate: vi.fn(),
      getVolume: vi.fn().mockImplementation(() => {
        throw new Error('Player not ready');
      }),
      isMuted: vi.fn().mockImplementation(() => {
        throw new Error('Player not ready');
      }),
    };

    (adapter as any).player = mockPlayer;
    expect(adapter.getVolume()).toBe(100);
    expect(adapter.isMuted()).toBe(false);

    adapter.destroy();
    expect(adapter.getVolume()).toBe(100);
    expect(adapter.isMuted()).toBe(false);
  });
});
