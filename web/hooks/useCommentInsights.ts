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

/** Strict UUID gate before an id is interpolated into a request path (Codacy URL-flow finding). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * 'failed'/'none'. State resets on every analysisId change (no ghosting of
 * analysis A's card into B). In-flight fetches are aborted on unmount or
 * analysisId change. A transient poll failure (network error or non-OK
 * response) is logged and the next tick is still scheduled, until the cap.
 */
export function useCommentInsights(analysisId: string | null, status: string): CommentInsightsResult {
  const [result, setResult] = useState<CommentInsightsResult>({ state: 'none', insights: null });
  const rawPayload = useSynthesisNucleus((s) => s.rawAnalysisPayload);
  const rawPayloadId = useSynthesisNucleus((s) => s.rawAnalysisPayloadId);
  const payloadForThisAnalysis = analysisId && rawPayloadId === analysisId ? rawPayload : null;
  const validId = analysisId && UUID_RE.test(analysisId) ? analysisId : null;

  // Reset on every analysis switch, then derive synchronously when the
  // payload (streaming or restored) already carries validated insights.
  useEffect(() => {
    const insights = validId ? readInsightsFromPayload(payloadForThisAnalysis) : null;
    setResult(insights ? { state: 'ready', insights } : { state: 'none', insights: null });
  }, [validId, payloadForThisAnalysis]);

  // Run-status fetch + bounded poll when insights aren't in memory yet.
  useEffect(() => {
    if (!validId || status !== 'complete') return;
    if (readInsightsFromPayload(payloadForThisAnalysis)) return;

    const controller = new AbortController();
    const { signal } = controller;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + POLL_CAP_MS;
    const analysisPath = `/api/analyses/${encodeURIComponent(validId)}`;
    const runPath = `/api/comments/runs/${encodeURIComponent(validId)}`;

    /** Single I/O point: JSON body, or null on a non-OK response. A request
     *  that finishes after cancellation also clears any stray poll timer. */
    const getJson = async (path: string): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch(path, { signal });
        return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
      } finally {
        if (signal.aborted && pollTimer !== null) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
      }
    };

    /** 'ready' when insights landed, 'absent' when the payload has none, 'error' on a transient failure. */
    const fetchInsightsFromPersistedPayload = async (): Promise<'ready' | 'absent' | 'error'> => {
      const data = await getJson(analysisPath);
      if (!data) return 'error';
      const insights = readInsightsFromPayload(data.analysis_payload);
      if (!insights) return 'absent';
      if (!signal.aborted) setResult({ state: 'ready', insights });
      return 'ready';
    };

    /** The run row, null when none exists, 'error' on a transient failure. */
    const fetchRunStatus = async (): Promise<CommentRunStatus | null | 'error'> => {
      const data = await getJson(runPath);
      if (!data) return 'error';
      return (data.run as CommentRunStatus | null) ?? null;
    };

    const scheduleNext = (): void => {
      if (signal.aborted) return;
      if (Date.now() + POLL_INTERVAL_MS > deadline) {
        // Cap reached: never leave a permanent "Analyzing…" label.
        setResult({ state: 'none', insights: null });
        return;
      }
      pollTimer = setTimeout(() => {
        pollTimer = null;
        void tick(false);
      }, POLL_INTERVAL_MS);
    };

    // The full persisted payload is read once up front and once on
    // completion; poll ticks only hit the small run-status route.
    const tick = async (checkPayloadFirst: boolean): Promise<void> => {
      try {
        if (checkPayloadFirst && (await fetchInsightsFromPersistedPayload()) === 'ready') return;
        const run = await fetchRunStatus();
        if (signal.aborted) return;
        if (run === 'error') {
          console.warn('[useCommentInsights] run-status poll returned non-OK; retrying');
          scheduleNext();
          return;
        }
        if (!run) {
          setResult({ state: 'none', insights: null });
          return;
        }
        if (run.status === 'completed') {
          // Insights should have been persisted with the run; if the refetch
          // fails transiently keep polling, if they are truly absent report failed.
          const outcome = await fetchInsightsFromPersistedPayload();
          if (outcome === 'error') { scheduleNext(); return; }
          if (outcome === 'absent' && !signal.aborted) setResult({ state: 'failed', insights: null });
          return;
        }
        if (run.status === 'failed') {
          setResult({ state: 'failed', insights: null });
          return;
        }
        if (run.status === 'pending' || run.status === 'sampling') {
          setResult({ state: 'analyzing', insights: null });
          scheduleNext();
          return;
        }
        setResult({ state: 'none', insights: null });
      } catch (err: unknown) {
        if (signal.aborted) return; // cancellation, not an error
        console.warn('[useCommentInsights] poll failed; retrying', err);
        scheduleNext();
      }
    };

    void tick(true);

    return () => {
      controller.abort();
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };
  }, [validId, status, payloadForThisAnalysis]);

  return result;
}
