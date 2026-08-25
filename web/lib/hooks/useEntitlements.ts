import { useState, useEffect, useCallback } from 'react';
import type { EntitlementState } from '@/lib/usecases/GetUserEntitlementsUseCase';

let globalCache: EntitlementState | null = null;
let globalPromise: Promise<EntitlementState> | null = null;

const defaultFree: EntitlementState = {
  tier: 'free',
  canAnalyzeVideo: true,
  canAccessKnowledgeGraph: false,
  canUseExtendedChat: false,
};

export function useEntitlements() {
  const [entitlements, setEntitlements] = useState<EntitlementState>(globalCache || defaultFree);
  const [isLoading, setIsLoading] = useState<boolean>(!globalCache);

  const fetchEntitlements = useCallback(async (force = false) => {
    if (!force && globalCache) {
      setEntitlements(globalCache);
      setIsLoading(false);
      return globalCache;
    }

    if (!force && globalPromise) {
      setIsLoading(true);
      const res = await globalPromise;
      setEntitlements(res);
      setIsLoading(false);
      return res;
    }

    setIsLoading(true);
    globalPromise = fetch('/api/billing/entitlements')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch entitlements');
        return res.json();
      })
      .then((data) => {
        if (data && data.success && data.entitlements) {
          globalCache = data.entitlements;
          return data.entitlements;
        }
        return defaultFree;
      })
      .catch((err) => {
        console.error('[useEntitlements] Error fetching entitlements:', err);
        return defaultFree;
      })
      .finally(() => {
        globalPromise = null;
      });

    const result = await globalPromise;
    setEntitlements(result);
    setIsLoading(false);
    return result;
  }, []);

  useEffect(() => {
    fetchEntitlements();
  }, [fetchEntitlements]);

  return {
    entitlements,
    isLoading,
    isFounder: entitlements.tier === 'founder',
    isPro: entitlements.tier === 'pro',
    refreshEntitlements: () => fetchEntitlements(true),
  };
}

export function clearEntitlementsCache() {
  globalCache = null;
  globalPromise = null;
}
