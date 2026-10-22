import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getCachedQuery, peekCachedQuery } from '@/lib/utils/client-cache';

export interface UsageSummary {
  periodStart: string;
  tier: string;
  analyses: { used: number; quota: number | null };
  chatTurns: { synthesisConsole: number; atlas: number; total: number };
  estimatedCostUsd: number;
}

/** Fetches the current user's this-month usage (GET /api/usage/summary) once on mount with 5-minute client cache scoped to userId. */
export function useUsageSummary(enabled: boolean, overrideUserId?: string) {
  const { user } = useAuth();
  const userId = overrideUserId ?? user?.id;
  const cacheKey = userId ? `usage-summary:${userId}` : null;

  const cached = cacheKey ? peekCachedQuery<UsageSummary>(cacheKey) : undefined;
  const [summary, setSummary] = useState<UsageSummary | null>(cached ?? null);
  const [loading, setLoading] = useState(Boolean(enabled && userId && !cached));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If not enabled or unauthenticated, bypass cache and do not issue query
    if (!enabled || !userId || !cacheKey) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    if (!cached) setLoading(true);
    setError(null);

    void (async () => {
      try {
        const data = await getCachedQuery<UsageSummary>(
          cacheKey,
          async () => {
            const res = await fetch('/api/usage/summary');
            if (!res.ok) {
              throw new Error(`Failed to load usage (${res.status})`);
            }
            return (await res.json()) as UsageSummary;
          },
          { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
        );
        if (!cancelled) setSummary(data);
      } catch (err) {
        console.error('[useUsageSummary]', err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load usage');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, userId, cacheKey, cached]);

  return { summary, loading, error };
}
