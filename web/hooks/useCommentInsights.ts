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

type RunLookup = CommentRunStatus | null | 'error';
type SetResult = (next: CommentInsightsResult) => void;

const API_PREFIX = { analysis: '/api/analyses/', run: '/api/comments/runs/' } as const;

/**
 * Single I/O point: JSON body, or null on a non-OK response (whose unread
 * body is released). The request URL is built here from a fixed same-origin
 * prefix plus a UUID-checked id, and rejected unless it resolves to this
 * origin -- no caller-supplied URL ever reaches fetch.
 */
async function getJson(endpoint: keyof typeof API_PREFIX, analysisId: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  if (!UUID_RE.test(analysisId)) return null;
  const url = new URL(API_PREFIX[endpoint] + encodeURIComponent(analysisId), window.location.origin);
  if (url.origin !== window.location.origin) return null;
  let res: Response | null = null;
  try {
    res = await fetch(url.pathname, { signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } finally {
    if (res && !res.bodyUsed) void res.body?.cancel().catch(() => undefined);
  }
}

/** 'ready' + insights, 'absent' when the persisted payload has none, 'error' on a transient failure. */
async function readPersistedInsights(analysisId: string, signal: AbortSignal): Promise<CommentInsights | 'absent' | 'error'> {
  const data = await getJson('analysis', analysisId, signal);
  if (!data) return 'error';
  return readInsightsFromPayload(data.analysis_payload) ?? 'absent';
}

async function readRunStatus(analysisId: string, signal: AbortSignal): Promise<RunLookup> {
  const data = await getJson('run', analysisId, signal);
  if (!data) return 'error';
  return (data.run as CommentRunStatus | null) ?? null;
}

/** Abortable delay: resolves after `ms`, or immediately once `signal` aborts. */
async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * One run-status observation -> the next state. 'retry' keeps polling
 * (transient failure or still pending/sampling); 'done' stops.
 */
async function applyRunStatus(run: RunLookup, analysisId: string, signal: AbortSignal, setResult: SetResult): Promise<'done' | 'retry'> {
  if (run === 'error') {
    console.warn('[useCommentInsights] run-status poll returned non-OK; retrying');
    return 'retry';
  }
  if (run?.status === 'pending' || run?.status === 'sampling') {
    setResult({ state: 'analyzing', insights: null });
    return 'retry';
  }
  if (run?.status === 'completed') {
    const persisted = await readPersistedInsights(analysisId, signal);
    if (persisted === 'error') return 'retry';
    setResult(persisted === 'absent' ? { state: 'failed', insights: null } : { state: 'ready', insights: persisted });
    return 'done';
  }
  setResult({ state: run?.status === 'failed' ? 'failed' : 'none', insights: null });
  return 'done';
}

/**
 * The run-status state machine as one sequential loop (no timer recursion).
 * The persisted payload is read once up front and once on completion; each
 * iteration otherwise only hits the small run-status route. A network error
 * or non-OK response is logged and retried on the next iteration. At the
 * cap the state drops to 'none' -- never a permanent "Analyzing…".
 */
async function pollCommentInsights(analysisId: string, signal: AbortSignal, setResult: SetResult): Promise<void> {
  const deadline = Date.now() + POLL_CAP_MS;
  try {
    const persisted = await readPersistedInsights(analysisId, signal);
    if (typeof persisted === 'object') {
      setResult({ state: 'ready', insights: persisted });
      return;
    }
  } catch (err: unknown) {
    if (signal.aborted) return;
    console.warn('[useCommentInsights] initial payload read failed; polling', err);
  }
  while (!signal.aborted) {
    let outcome: 'done' | 'retry' = 'retry';
    try {
      const run = await readRunStatus(analysisId, signal);
      if (signal.aborted) return;
      outcome = await applyRunStatus(run, analysisId, signal, setResult);
    } catch (err: unknown) {
      if (signal.aborted) return; // cancellation, not an error
      console.warn('[useCommentInsights] poll failed; retrying', err);
    }
    if (outcome === 'done' || signal.aborted) return;
    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      setResult({ state: 'none', insights: null });
      return;
    }
    await sleep(POLL_INTERVAL_MS, signal);
  }
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
    if (!validId || status !== 'complete') return undefined;
    if (readInsightsFromPayload(payloadForThisAnalysis)) return undefined;
    const controller = new AbortController();
    void pollCommentInsights(validId, controller.signal, setResult);
    return () => controller.abort();
  }, [validId, status, payloadForThisAnalysis]);

  return result;
}
