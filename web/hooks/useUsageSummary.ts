import { useEffect, useState } from 'react';

export interface UsageSummary {
  periodStart: string;
  tier: string;
  analyses: { used: number; quota: number | null };
  chatTurns: { synthesisConsole: number; atlas: number; total: number };
  estimatedCostUsd: number;
}

/** Fetches the current user's this-month usage (GET /api/usage/summary) once on mount. */
export function useUsageSummary(enabled: boolean) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch('/api/usage/summary');
        if (!res.ok) {
          if (!cancelled) setError(`Failed to load usage (${res.status})`);
          return;
        }
        const data = (await res.json()) as UsageSummary;
        if (!cancelled) setSummary(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load usage');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { summary, loading, error };
}
