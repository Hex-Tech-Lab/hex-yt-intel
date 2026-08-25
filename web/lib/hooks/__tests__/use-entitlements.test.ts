/** @vitest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEntitlements, clearEntitlementsCache } from '../useEntitlements';

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
      json: async () => mockData,
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
      json: async () => mockData,
    });

    const { result } = renderHook(() => useEntitlements());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isFounder).toBe(false);
    expect(result.current.isPro).toBe(true);
  });
});
