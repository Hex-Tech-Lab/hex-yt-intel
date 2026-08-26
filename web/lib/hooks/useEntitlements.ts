import { useState, useEffect, useCallback } from 'react';

import { clientAuthAdapter } from '@/lib/adapters/SupabaseClientAuthAdapter';

import type { EntitlementState } from '@/lib/usecases/GetUserEntitlementsUseCase';

// Keyed by user ID to prevent tenant bleed.
const globalCache = new Map<string, EntitlementState>();
const globalPromises = new Map<string, Promise<EntitlementState>>();

const defaultFree: EntitlementState = {
  tier: 'free',
  canAnalyzeVideo: true,
  canAccessKnowledgeGraph: false,
  canUseExtendedChat: false,
};

let authListenerAttached = false;
let currentUserId: string | null = null;

export function useEntitlements() {
  const [userId, setUserId] = useState<string | null>(currentUserId);
  const [entitlements, setEntitlements] = useState<EntitlementState>(
    (currentUserId && globalCache.get(currentUserId)) || defaultFree
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [isSessionLoaded, setIsSessionLoaded] = useState<boolean>(false);

  useEffect(() => {
    // Initial fetch of session via adapter
    clientAuthAdapter.getSessionUserId().then((id) => {
      if (id !== currentUserId) {
        currentUserId = id;
        setUserId(id);
      }
      setIsSessionLoaded(true);
    });

    if (!authListenerAttached && typeof window !== 'undefined') {
      authListenerAttached = true;
      clientAuthAdapter.onAuthStateChange((event, id) => {
        currentUserId = id;
        if (event === 'SIGNED_OUT') {
          globalCache.clear();
          globalPromises.clear();
        }
      });
    }

    const unsubscribe = clientAuthAdapter.onAuthStateChange((event, id) => {
      setUserId(id);
      if (event === 'SIGNED_OUT') {
        setEntitlements(defaultFree);
        setIsLoading(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const fetchEntitlements = useCallback(async (force = false) => {
    if (!isSessionLoaded) {
      return defaultFree; // Keep loading true while session loads
    }
    if (!userId) {
      setIsLoading(false);
      return defaultFree;
    }

    if (!force && globalCache.has(userId)) {
      const cached = globalCache.get(userId)!;
      setEntitlements(cached);
      setIsLoading(false);
      return cached;
    }

    if (!force && globalPromises.has(userId)) {
      setIsLoading(true);
      const res = await globalPromises.get(userId)!;
      setEntitlements(res);
      setIsLoading(false);
      return res;
    }

    setIsLoading(true);
    const doFetch = async () => {
      try {
        const res = await fetch('/api/billing/entitlements');
        if (!res.ok) throw new Error('Failed to fetch entitlements');
        const data = await res.json();
        if (data && data.success && data.entitlements) {
          globalCache.set(userId, data.entitlements);
          return data.entitlements;
        }
        return defaultFree;
      } catch (err) {
        console.error('[useEntitlements] Error fetching entitlements:', err);
        return defaultFree;
      } finally {
        globalPromises.delete(userId);
      }
    };

    const promise = doFetch();
    globalPromises.set(userId, promise);
    const result = await promise;
    setEntitlements(result);
    setIsLoading(false);
    return result;
  }, [userId, isSessionLoaded]);

  useEffect(() => {
    fetchEntitlements();
  }, [fetchEntitlements, isSessionLoaded]);

  return {
    entitlements,
    isLoading,
    isFounder: entitlements.tier === 'founder',
    isPro: entitlements.tier === 'pro',
    refreshEntitlements: () => fetchEntitlements(true),
  };
}

export function clearEntitlementsCache() {
  globalCache.clear();
  globalPromises.clear();
  currentUserId = null;
  authListenerAttached = false;
}
