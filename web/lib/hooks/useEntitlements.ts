import { useState, useEffect, useCallback, useRef } from 'react';

import { clientAuthAdapter } from '@/lib/adapters/SupabaseClientAuthAdapter';

import type { EntitlementState } from '@/lib/usecases/GetUserEntitlementsUseCase';

const globalCache = new Map<string, EntitlementState>();
const globalPromises = new Map<string, Promise<EntitlementState>>();

const defaultFree: EntitlementState = {
  tier: 'free',
  is_founder: false,
  is_enterprise: false,
  is_unlimited: false,
  canAnalyzeVideo: true,
  canAccessKnowledgeGraph: false,
  canUseExtendedChat: false,
  canExportKnowledgeGraph: false,
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
  const activeUserIdRef = useRef<string | null>(currentUserId);

  useEffect(() => {
    activeUserIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    clientAuthAdapter.getSessionUserId().then((id) => {
      if (id !== currentUserId) {
        currentUserId = id;
        setUserId(id);
        setEntitlements(defaultFree);
        setIsLoading(true);
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
      setEntitlements(defaultFree);
      setIsLoading(true);
      setUserId(id);
      currentUserId = id;
      if (event === 'SIGNED_OUT') {
        setIsLoading(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const fetchEntitlements = useCallback(async (force = false) => {
    if (!isSessionLoaded) {
      return defaultFree;
    }
    if (!userId) {
      setIsLoading(false);
      return defaultFree;
    }

    if (!force && globalCache.has(userId)) {
      const cached = globalCache.get(userId)!;
      if (activeUserIdRef.current === userId) {
        setEntitlements(cached);
        setIsLoading(false);
      }
      return cached;
    }

    if (!force && globalPromises.has(userId)) {
      setIsLoading(true);
      const res = await globalPromises.get(userId)!;
      if (activeUserIdRef.current === userId) {
        setEntitlements(res);
        setIsLoading(false);
      }
      return res;
    }

    setIsLoading(true);
    const fetchUserId = userId;
    const doFetch = async () => {
      try {
        const res = await fetch('/api/billing/entitlements');
        if (!res.ok) throw new Error('Failed to fetch entitlements');
        const data = await res.json();
        if (data && data.success && data.entitlements) {
          globalCache.set(fetchUserId, data.entitlements);
          return data.entitlements;
        }
        return defaultFree;
      } catch (err) {
        console.error('[useEntitlements] Error fetching entitlements:', err);
        return defaultFree;
      } finally {
        globalPromises.delete(fetchUserId);
      }
    };

    const promise = doFetch();
    globalPromises.set(fetchUserId, promise);
    const result = await promise;
    if (activeUserIdRef.current === fetchUserId) {
      setEntitlements(result);
      setIsLoading(false);
    }
    return result;
  }, [userId, isSessionLoaded]);

  useEffect(() => {
    fetchEntitlements();
  }, [fetchEntitlements, isSessionLoaded]);

  const canShowUpgradePrompt = !isLoading && !entitlements.is_founder && !entitlements.is_enterprise && !entitlements.is_unlimited && entitlements.tier === 'free';

  return {
    entitlements,
    isLoading,
    isFounder: !!entitlements.is_founder || entitlements.tier === 'founder',
    isPro: entitlements.tier === 'pro',
    isEnterprise: !!entitlements.is_enterprise || entitlements.tier === 'enterprise',
    canShowUpgradePrompt,
    refreshEntitlements: () => fetchEntitlements(true),
  };
}

export function clearEntitlementsCache() {
  globalCache.clear();
  globalPromises.clear();
  currentUserId = null;
  authListenerAttached = false;
}
