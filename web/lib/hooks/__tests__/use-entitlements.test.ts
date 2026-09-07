/** @vitest-environment jsdom */
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useEntitlements, clearEntitlementsCache } from '../useEntitlements';
import { clientAuthAdapter } from '@/lib/adapters/SupabaseClientAuthAdapter';

vi.mock('@/lib/adapters/SupabaseClientAuthAdapter', () => ({
  clientAuthAdapter: {
    getSessionUserId: vi.fn().mockResolvedValue('test-user-123'),
    onAuthStateChange: vi.fn().mockReturnValue(vi.fn()),
  },
}));

describe('useEntitlements hook', () => {
  beforeEach(() => {
    clearEntitlementsCache();
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('Test 1: Returns loading state initially, then resolves entitlement payload', async () => {
    const mockData = {
      success: true,
      entitlements: { tier: 'founder', canAnalyzeVideo: true, canAccessKnowledgeGraph: true, canUseExtendedChat: true },
    };
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useEntitlements());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.entitlements).toEqual(mockData.entitlements);
  });

  it('Test 2: Helper flags correctly reflect API state', async () => {
    const mockData = {
      success: true,
      entitlements: { tier: 'pro', canAnalyzeVideo: true, canAccessKnowledgeGraph: true, canUseExtendedChat: true },
    };
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useEntitlements());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isFounder).toBe(false);
    expect(result.current.isPro).toBe(true);
  });

  it('Test 3: same-user auth events (TOKEN_REFRESHED/USER_UPDATED) do not reset loaded entitlements', async () => {
    const mockData = {
      success: true,
      entitlements: { tier: 'founder', canAnalyzeVideo: true, canAccessKnowledgeGraph: true, canUseExtendedChat: true },
    };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useEntitlements());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.entitlements).toEqual(mockData.entitlements);

    // The hook registers two listeners (global + local); fire same-id events on both.
    const listeners = vi.mocked(clientAuthAdapter.onAuthStateChange).mock.calls.map((call) => call[0]);
    expect(listeners.length).toBeGreaterThanOrEqual(2);
    act(() => {
      for (const listener of listeners) {
        listener('TOKEN_REFRESHED', 'test-user-123');
        listener('USER_UPDATED', 'test-user-123');
        listener('INITIAL_SESSION', 'test-user-123');
      }
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.entitlements).toEqual(mockData.entitlements);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('Test 4: auth event with a changed user id resets state and refetches', async () => {
    const founderData = {
      success: true,
      entitlements: { tier: 'founder', canAnalyzeVideo: true, canAccessKnowledgeGraph: true, canUseExtendedChat: true },
    };
    const proData = {
      success: true,
      entitlements: { tier: 'pro', canAnalyzeVideo: true, canAccessKnowledgeGraph: true, canUseExtendedChat: true },
    };
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(founderData) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(proData) });

    const { result } = renderHook(() => useEntitlements());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.entitlements).toEqual(founderData.entitlements);

    const localListener = vi
      .mocked(clientAuthAdapter.onAuthStateChange)
      .mock.calls.map((call) => call[0])
      .at(-1)!;
    act(() => {
      localListener('SIGNED_IN', 'other-user-456');
    });

    await waitFor(() => {
      expect(result.current.entitlements).toEqual(proData.entitlements);
    });
    expect(result.current.isLoading).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
