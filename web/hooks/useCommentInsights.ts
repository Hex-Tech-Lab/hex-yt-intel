import { useEffect, useState } from 'react';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { CommentInsightsSchema, type CommentInsights, type CommentRunStatus } from '@/lib/types/comment-insights';

export type CommentInsightsState = 'none' | 'analyzing' | 'ready' | 'failed';

export interface CommentInsightsResult {
  state: CommentInsightsState;
  insights: CommentInsights | null;
}

/** Poll interval while a run is pending/sampling. */
const POLL_INTERVAL_MS = 5000;
/** Hard cap on total polling time; after this the hook stops polling and drops back to 'none' (never a permanent "Analyzing…" label). */
const POLL_CAP_MS = 3 * 60 * 1000;

function readInsightsFromPayload(payload: unknown): CommentInsights | null {
  if (!payload || typeof payload !== 'object') return null;
  const field = (payload as { commentInsights?: unknown }).commentInsights;
  if (!field) return null;
  const parsed = CommentInsightsSchema.safeParse(field);
  return parsed.success ? parsed.data : null;
}

/**
 * Comments Dispatch B: sentiment-run status + Sampled-pool insights state.
 *
 * Read order: (1) commentInsights already in the in-memory payload for THIS
 * analysis (same rawAnalysisPayloadId guard as useAuxElementStatus — the
 * store slot is global, not keyed per analysis) → 'ready'; (2) else fetch
 * the run status — pending|sampling → 'analyzing' with a bounded 5s poll
 * (3-minute cap); completed → refetch the persisted payload (same endpoint
 * useAuxElementStatus uses) and derive insights from it; failed/absent →
 * 'failed'/'none'. Polling and fetches are abortable on unmount or
 * analysisId change.
 */
export function useCommentInsights(analysisId: string | null, status: string): CommentInsightsResult {
  const [result, setResult] = useState<CommentInsightsResult>({ state: 'none', insights: null });
  const rawPayload = useSynthesisNucleus((s) => s.rawAnalysisPayload);
  const rawPayloadId = useSynthesisNucleus((s) => s.rawAnalysisPayloadId);
  const payloadForThisAnalysis = analysisId && rawPayloadId === analysisId ? rawPayload : null;

  // Synchronous derivation when the payload (streaming or restored) already
  // carries validated insights.
  useEffect(() => {
    if (!analysisId) {
      setResult({ state: 'none', insights: null });
      return;
    }
    const insights = readInsightsFromPayload(payloadForThisAnalysis);
    if (insights) {
      setResult({ state: 'ready', insights });
    }
  }, [analysisId, payloadForThisAnalysis]);

  // Run-status fetch + bounded poll when insights aren't in memory yet.
  useEffect(() => {
    if (!analysisId || status !== 'complete') return;
    if (readInsightsFromPayload(payloadForThisAnalysis)) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + POLL_CAP_MS;

    const fetchInsightsFromPersistedPayload = async (): Promise<boolean> => {
      try {
        const res = await fetch(`/api/analyses/${analysisId}`);
        if (!res.ok) return false;
        const data = await res.json();
        if (cancelled) return true;
        const insights = readInsightsFromPayload(data.analysis_payload);
        if (insights) {
          setResult({ state: 'ready', insights });
          return true;
        }
        return false;
      } finally {
        if (cancelled && pollTimer) clearTimeout(pollTimer);
      }
    };

    const fetchRunStatus = async (): Promise<CommentRunStatus | null> => {
      try {
        const res = await fetch(`/api/comments/runs/${analysisId}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (cancelled) return null;
        return (data.run as CommentRunStatus | null) ?? null;
      } finally {
        if (cancelled && pollTimer) clearTimeout(pollTimer);
      }
    };

    // The full persisted payload is read once up front and once on
    // completion; poll ticks only hit the small run-status route.
    const tick = async (checkPayloadFirst: boolean): Promise<void> => {
      if (cancelled) return;
      if (checkPayloadFirst && await fetchInsightsFromPersistedPayload()) return;
      if (cancelled) return;
      const run = await fetchRunStatus();
      if (cancelled) return;
      if (!run) {
        setResult((prev) => (prev.state === 'ready' ? prev : { state: 'none', insights: null }));
        return;
      }
      if (run.status === 'completed') {
        // Insights should have been persisted with the run; one refetch, and
        // if still absent treat as failed rather than reporting ready-without-data.
        if (await fetchInsightsFromPersistedPayload()) return;
        if (!cancelled) setResult({ state: 'failed', insights: null });
        return;
      }
      if (run.status === 'failed') {
        setResult({ state: 'failed', insights: null });
        return;
      }
      if (run.status === 'pending' || run.status === 'sampling') {
        if (Date.now() + POLL_INTERVAL_MS > deadline) {
          setResult({ state: 'none', insights: null });
          return;
        }
        setResult({ state: 'analyzing', insights: null });
        pollTimer = setTimeout(() => {
          pollTimer = null;
          tick(false).catch((err: unknown) => console.debug('[useCommentInsights] poll failed:', err));
        }, POLL_INTERVAL_MS);
        return;
      }
      setResult({ state: 'none', insights: null });
    };

    tick(true).catch((err: unknown) => console.debug('[useCommentInsights] failed:', err));

    return () => {
      cancelled = true;
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };
  }, [analysisId, status, payloadForThisAnalysis]);

  return result;
}
