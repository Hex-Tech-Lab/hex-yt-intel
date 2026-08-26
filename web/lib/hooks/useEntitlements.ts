import { useState, useEffect, useCallback } from 'react';

import { getSupabaseClient } from '@/lib/supabase';

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
    const supabase = getSupabaseClient();
    
    // Initial fetch of session
    supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user?.id || null;
      if (id !== currentUserId) {
        currentUserId = id;
        setUserId(id);
      }
      setIsSessionLoaded(true);
    });

    if (!authListenerAttached && typeof window !== 'undefined') {
      authListenerAttached = true;
      supabase.auth.onAuthStateChange((event, session) => {
        const id = session?.user?.id || null;
        currentUserId = id;
        
        if (event === 'SIGNED_OUT') {
          globalCache.clear();
          globalPromises.clear();
        }
        
        // Broadcast the new auth state (React state will catch up via individual component renders)
        // For components already mounted, this listener doesn't trigger setUserId directly 
        // across all instances, so we also rely on the per-component listener.
      });
    }

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
    });

    return () => {
      listener.subscription.unsubscribe();
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
