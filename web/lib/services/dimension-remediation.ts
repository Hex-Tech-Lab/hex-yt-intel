/**
 * Dimension Remediation (per-dimension recovery for partial analyses)
 *
 * sweepStuckAnalyses (analysis-reaper.ts, ADR 007) settles a stuck
 * `processing` row to a terminal state but never regenerates content -- a
 * row genuinely missing dimensions stays missing forever, with "Re-analyze"
 * (full 11-dimension regeneration) as the only user-facing fix. This module
 * fills that gap for the narrower case: an analysis that already has SOME
 * dimensions, just not all of them.
 *
 * Verified against production data (2026-07-30, 179 total analyses): ~45
 * (25%) are `billing_status = 'failed'` with `validation_report.status =
 * 'partial'` and real markdown content -- not a rare edge case.
 *
 * Reuse, not reinvent: this calls the EXACT same worker endpoint and models
 * the live bundle-stream flow uses (CreateAnalysisUseCase -> browser ->
 * worker/src/routes/analysis.ts's `/analyze-llm-stream`, which already
 * accepts `dimensions: number[]` to scope generation to a subset), and
 * merges the result with the EXACT same stitchChunksIntoPayload port
 * analysis-reaper.ts's tryChunkRecovery already reuses. Kept as a sibling
 * service to analysis-reaper.ts, not merged into it -- sweepStuckAnalyses
 * has one consumer today (billing/history status settlement) with one
 * guarantee (never leaves a row in `processing`); remediation is a second
 * consumer with a different guarantee (regenerates content), and mixing
 * them would blur both.
 *
 * Budget/concurrency (ADR 019, 2026-07-31 -- see
 * docs/specs/ADR_019_REMEDIATION_BUDGET_TOKEN_BUCKET_2026-07-31.md):
 * OpenRouter exposes no hard concurrency limit (rate_limit.requests is -1,
 * deprecated, live-verified against the real account). The actual
 * constraint is the account's monthly $ spend cap, shared with live paying
 * traffic. Pacing is therefore a dollar-denominated token bucket (Redis Lua,
 * see lib/redis.ts's tryConsumeTokenBucket), NOT a mutex lock + fixed batch
 * size -- an earlier version of this file used a Redis run-level lock with
 * a hardcoded limit=3; replaced because concurrency/throughput should fall
 * out of budget availability, not an arbitrary picked number, and because
 * money is spent per-candidate BEFORE the worker call, not gated by a
 * cross-run mutex that says nothing about cost.
 */
import * as Sentry from '@sentry/nextjs';

import { getSupabaseServiceClient } from '@/lib/supabase';
import { env } from '@/lib/env';
import { signStreamToken } from '@/lib/stream-token';
import { resolveAnalysisCascade } from '@/lib/config/cascade';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';
import { stitchChunksIntoPayload, buildDimensionStatus } from '@/lib/services/stitch-analysis-chunks';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import { tryConsumeTokenBucket, incrementRedisValue } from '@/lib/redis';

/**
 * Per-candidate outcome. Doubles as the tally key in RemediationSweepResult
 * (runRemediationHarness switches on this directly) -- deliberately a single
 * field, not a separate stage+outcome pair, so there is exactly one place a
 * result can say what happened.
 */
export enum RemediationStage {
  BudgetExhausted = 'budget_exhausted', // token bucket had insufficient funds -- not an error, stop this cycle
  WorkerFailed = 'worker_failed',
  StitchFailed = 'stitch_failed',
  PersistRaced = 'persist_raced', // guarded write lost -- a concurrent Re-analyze won
  Remediated = 'remediated', // persisted, all TOTAL_DIMENSIONS now present
  StillPartial = 'still_partial', // persisted, improved but still short
}

/**
 * Every tunable here is a Settings Registry key (ADR 019) -- none of these
 * are the value used at runtime, only the fallback if the registry itself
 * is unreachable (SupabaseSettingsAdapter.getRegistrySettings's own
 * contract: never cache/pin a fallback, retry the DB next call). Keep these
 * fallbacks in sync with the migration's seeded defaults
 * (20260731000000_remediation_budget_settings.sql), same convention
 * analysis.maxOutputTokens.* already established.
 */
const REGISTRY_FALLBACK = {
  'remediation.enabled': true,
  'remediation.budgetPercentOfRemaining': 10,
  'remediation.hardCapUsdCents': 200,
  'remediation.periodDays': 30,
  'remediation.maxRetries': 3,
} as const;

const TOKEN_BUCKET_KEY = 'budget:dimension-remediation';
const PENDULUM_COUNTER_KEY = 'counter:dimension-remediation-pendulum';
// OpenRouter's own management API (GET /api/v1/auth/key) -- undocumented/
// unversioned, same UNVERIFIED_ENDPOINT_NO_TEST risk class contract-auditor
// already flags for other management APIs in this repo. If this ever 404s
// or changes shape, fail closed (zero capacity), never assume unlimited --
// see getRemainingBudgetCents.
const OPENROUTER_KEY_INFO_URL = 'https://openrouter.ai/api/v1/auth/key';
const OPENROUTER_BALANCE_CACHE_MS = 5 * 60_000;

let cachedRemainingBudgetCents: { value: number; expiresAt: number } | null = null;

/**
 * Live remaining OpenRouter monthly balance, in cents. Cached briefly (5
 * min) so every candidate in a run doesn't re-fetch it. Fails closed (0,
 * not Infinity) on any error -- this feeds a money-gating token bucket, so
 * the safe failure mode is "spend nothing", not "spend without limit".
 */
async function getRemainingBudgetCents(): Promise<number> {
  const now = Date.now();
  if (cachedRemainingBudgetCents && cachedRemainingBudgetCents.expiresAt > now) {
    return cachedRemainingBudgetCents.value;
  }
  try {
    const res = await fetch(OPENROUTER_KEY_INFO_URL, {
      headers: { Authorization: `Bearer ${env.openrouterApiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter key-info returned ${res.status}`);
    const body = await res.json();
    const remaining = Number(body?.data?.limit_remaining);
    if (!Number.isFinite(remaining) || remaining < 0) throw new Error('OpenRouter key-info returned a non-numeric limit_remaining');
    const cents = Math.round(remaining * 100);
    cachedRemainingBudgetCents = { value: cents, expiresAt: now + OPENROUTER_BALANCE_CACHE_MS };
    return cents;
  } catch (err) {
    console.error('[dimension-remediation] failed to fetch OpenRouter remaining balance, failing closed', { err: err instanceof Error ? err.message : String(err) });
    Sentry.captureException(err, { contexts: { remediation: { service: 'dimension-remediation', phase: 'openrouter_balance' } } });
    return 0;
  }
}

/**
 * Resolve this run's token-bucket capacity/refill rate from the Settings
 * Registry + OpenRouter's live remaining balance. Recomputed every harness
 * invocation (not cached long-term) so a manual top-up or a registry change
 * takes effect on the very next tick.
 */
async function resolveBudgetParams(): Promise<{ capacityCents: number; refillRatePerMsCents: number; enabled: boolean; maxRetries: number }> {
  const settings = await SupabaseSettingsAdapter.getRegistrySettings(Object.keys(REGISTRY_FALLBACK), REGISTRY_FALLBACK);
  const enabled = Boolean(settings['remediation.enabled']);
  const percent = Number(settings['remediation.budgetPercentOfRemaining']) || 0;
  const hardCapCents = Number(settings['remediation.hardCapUsdCents']) || 0;
  const periodDays = Number(settings['remediation.periodDays']) || REGISTRY_FALLBACK['remediation.periodDays'];
  const maxRetries = Number(settings['remediation.maxRetries']) || REGISTRY_FALLBACK['remediation.maxRetries'];

  const remainingCents = await getRemainingBudgetCents();
  const percentDerivedCents = Math.floor((percent / 100) * remainingCents);
  const capacityCents = hardCapCents > 0 ? Math.min(percentDerivedCents, hardCapCents) : percentDerivedCents;
  const refillRatePerMsCents = capacityCents / (periodDays * 86_400_000);

  return { capacityCents, refillRatePerMsCents, enabled, maxRetries };
}

/**
 * Rough cost estimate (cents) for regenerating N dimensions, priced at the
 * cascade's cheapest resolved tier (LLMCascade tries tiers in order,
 * cheapest first) -- deliberately conservative-optimistic: reserved BEFORE
 * the call, not reconciled against actual token usage afterward (a stated
 * v1 limitation, not a hidden one). ~2000 tokens/dimension (prompt +
 * completion) is a rough content-length-based estimate, not a measured
 * average -- revisit once real per-dimension token usage is logged.
 */
const ESTIMATED_TOKENS_PER_DIMENSION = 2_000;
/** cascade's cheapest resolved cost/1K tokens -- computed once per harness run by the caller, not re-scanned per candidate (same "resolve once per run" convention the module already applies to cascade/models). */
function cheapestCostPer1K(cascade: Array<{ cost?: number }>): number {
  const cheapest = cascade.reduce((min, c) => (typeof c.cost === 'number' && c.cost < min ? c.cost : min), Infinity);
  return Number.isFinite(cheapest) ? cheapest : 0.002; // fallback if cascade has no cost data at all
}
function estimateCostCents(dimensionCount: number, costPer1K: number): number {
  return Math.ceil(dimensionCount * (ESTIMATED_TOKENS_PER_DIMENSION / 1000) * costPer1K * 100);
}

export interface AnalysisGap {
  id: string;
  videoId: string;
  title: string;
  channelTitle: string;
  metadata: Record<string, unknown>;
  analysisMarkdown: string;
  analysisPayload: Record<string, unknown> | null;
  validationReport: unknown;
  missingDimensions: number[];
}

export interface RemediationResult {
  analysisId: string;
  stage: RemediationStage;
  dimensionsRequested: number[];
  dimensionCountAfter?: number;
}

export interface RemediationSweepResult {
  scanned: number;
  remediated: number;
  stillPartial: number;
  skipped: number;
  errored: number;
  budgetExhausted: boolean;
  disabled: boolean;
}

/** Narrow an unknown jsonb value to a plain object, or {} for null/array/primitive. Shared by every read site that treats validation_report as a spreadable base. */
function asReportObject(report: unknown): Record<string, unknown> {
  return report && typeof report === 'object' && !Array.isArray(report) ? (report as Record<string, unknown>) : {};
}

/**
 * Pure: given an analysis's markdown, return which of the 1..TOTAL_DIMENSIONS
 * dimension numbers are absent. Exported for unit testing, same pattern as
 * analysis-reaper.ts's decideReapOutcome.
 */
export function computeMissingDimensions(markdown: string): number[] {
  const parsed = parseToUCISDimensions(markdown);
  const completedDimensions = new Set(Object.keys(parsed).map(Number));
  const missing: number[] = [];
  for (let d = 1; d <= TOTAL_DIMENSIONS; d++) {
    if (!completedDimensions.has(d)) missing.push(d);
  }
  return missing;
}

/**
 * Find analyses with real partial content and no path back to completion
 * except a full re-run. Deliberately narrow: `billing_status = 'failed'`
 * (NOT 'processing' -- that's the reaper's territory) AND
 * `validation_report.status = 'partial'` AND non-empty markdown, so a total
 * loss (empty markdown, nothing to build on) is never mistaken for a
 * remediation candidate.
 */
export async function findAnalysesWithMissingDimensions(opts?: {
  /** DB fetch page size -- a query-size safety bound, not a processing-batch limit (that's budget-gated now, see runRemediationHarness). Same non-registry-backed precedent as analysis-reaper.ts's own `limit ?? 500`. */
  limit?: number;
  /** Pendulum ordering (ADR 019): 'asc' = oldest-failed-first, 'desc' = newest-failed-first. Alternated per cycle by the caller so neither a long-stuck row nor a fresh failure is ever starved. */
  order?: 'asc' | 'desc';
  maxRetries?: number;
}): Promise<AnalysisGap[]> {
  const limit = opts?.limit ?? 100;
  const ascending = opts?.order !== 'desc';
  const maxRetries = opts?.maxRetries ?? REGISTRY_FALLBACK['remediation.maxRetries'];
  const service = getSupabaseServiceClient();

  const { data, error } = await service
    .from('analyses')
    .select('id, video_id, title, channel_title, analysis_markdown, analysis_payload, validation_report, billing_status')
    .eq('billing_status', 'failed')
    .eq('validation_report->>status', 'partial')
    .order('created_at', { ascending })
    .limit(limit);
  if (error) throw error;

  const gaps: AnalysisGap[] = [];
  for (const row of data ?? []) {
    const markdown = (row as { analysis_markdown?: string }).analysis_markdown ?? '';
    if (!markdown.trim()) continue; // total loss -- only a full re-run helps, not this path

    const missingDimensions = computeMissingDimensions(markdown);
    if (missingDimensions.length === 0) continue; // shouldn't happen given the status filter, but never remediate a row that's actually already whole

    const report = (row as { validation_report?: unknown }).validation_report;
    const reportObj = asReportObject(report);
    const reportMetadata = reportObj.metadata as Record<string, unknown> | undefined;

    // Exclude rows that have exceeded the retry limit to prevent unbounded
    // LLM billing on persistently failing analyses
    const retryCount = typeof reportObj.remediation_retry_count === 'number' ? reportObj.remediation_retry_count : 0;
    if (retryCount >= maxRetries) continue;

    gaps.push({
      id: (row as { id: string }).id,
      videoId: (row as { video_id: string }).video_id,
      title: (row as { title?: string }).title ?? '',
      channelTitle: (row as { channel_title?: string }).channel_title ?? '',
      metadata: reportMetadata ?? {},
      analysisMarkdown: markdown,
      analysisPayload: (row as { analysis_payload?: Record<string, unknown> | null }).analysis_payload ?? null,
      validationReport: report,
      missingDimensions,
    });
  }
  return gaps;
}

/**
 * Shared by both catch blocks in the worker-call/SSE-read path below (Codacy
 * duplication finding) -- same isTimeout-detect + structured console.error +
 * Sentry.captureException shape, differing only in the phase tag and log
 * message.
 */
function reportAbortableError(err: unknown, phase: 'worker_call' | 'sse_read', analysisId: string, logMessage: string): void {
  const isTimeout = err instanceof Error && err.name === 'AbortError';
  console.error(logMessage, { analysisId, isTimeout, err: err instanceof Error ? err.message : String(err) });
  Sentry.captureException(err, {
    contexts: { remediation: { service: 'dimension-remediation', phase, timeout: String(isTimeout), analysisId } },
  });
}

/**
 * Consume the worker's SSE stream server-side (no browser present in a cron
 * context) and accumulate the JSON fragments into one chunk-shaped payload,
 * matching what a single bundle stream produces for stitchChunksIntoPayload.
 *
 * Framing matches web/hooks/useSSEStream.ts's browser-side reader exactly
 * (split on blank-line-delimited SSE events, not raw `\n`) so the two stay
 * in sync with the wire format the worker actually emits
 * (`data: {...}\n\n`, worker/src/routes/analysis.ts). Kept as a separate,
 * server-only implementation rather than importing the browser hook
 * directly -- useSSEStream.ts is coupled to React state/AbortSignal/adapter
 * callbacks that don't apply in a cron context -- but a shared
 * `parseSSEStream(response, onEvent)` extraction is the deeper fix if a
 * third consumer of this exact framing ever shows up.
 */
async function collectDimensionsFromWorker(
  gap: AnalysisGap,
  models: string[],
  cascade: Array<{ model: string; name: string; cost?: number; providerOrder?: string[] }>
): Promise<Record<string, unknown> | null> {
  const token = await signStreamToken(gap.videoId, gap.id, models);

  const body = {
    videoId: gap.videoId,
    analysisId: gap.id,
    // ADR 019: tagged distinctly from a real end-user id (which live
    // traffic populates this same field with) so remediation calls are
    // filterable in OpenRouter's own dashboard by this prefix -- the
    // concrete before/after metric for "how many of the partial-analysis
    // population actually got fixed", not just inferred from our own DB.
    userId: `remediation:${gap.id}`,
    transcript: '', // worker re-fetches when missing/placeholder -- same fallback the live route already relies on
    metadata: {
      title: gap.title,
      channelTitle: gap.channelTitle,
      publishedAt: (gap.metadata.publishedAt as string) ?? '',
      duration: (gap.metadata.duration as number) ?? 0,
      viewCount: (gap.metadata.viewCount as string | number) ?? '0',
      likeCount: (gap.metadata.likeCount as string | number) ?? '0',
      commentCount: (gap.metadata.commentCount as string | number) ?? '0',
    },
    persona: (gap.metadata.persona as string) ?? 'creator',
    timezone: (gap.metadata.timezone as string) ?? 'UTC',
    models,
    cascade,
    dimensions: gap.missingDimensions,
    sig: token.sig,
    exp: token.exp,
  };

  // Stratified dual-timeout architecture (CLAUDE.md Law #2):
  // - Connection handshake: 3-second hard timeout
  // - Token streaming window: 90-second maximum read (Worker budget)
  const CONNECTION_TIMEOUT_MS = 3_000;
  const STREAMING_TIMEOUT_MS = 90_000;
  const abortController = new AbortController();

  // Connection timeout aborts stalled handshakes
  let connectionTimeoutId: NodeJS.Timeout | null = setTimeout(
    () => abortController.abort(),
    CONNECTION_TIMEOUT_MS
  );

  let res: Response;
  try {
    res = await fetch(`${env.cloudflareWorkerUrl}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
  } catch (err) {
    if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
    reportAbortableError(err, 'worker_call', gap.id, '[dimension-remediation] worker call threw');
    return null;
  }

  // Clear connection timeout and replace with streaming timeout
  if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
  connectionTimeoutId = null;
  const streamingTimeoutId = setTimeout(
    () => abortController.abort(),
    STREAMING_TIMEOUT_MS
  );

  if (!res.ok || !res.body) {
    clearTimeout(streamingTimeoutId);
    const errText = await res.text().catch(() => '');
    console.error('[dimension-remediation] worker call failed', { analysisId: gap.id, status: res.status, errText: errText.slice(0, 500) });
    Sentry.captureMessage('dimension-remediation: worker non-2xx response', {
      level: 'error',
      contexts: { remediation: { analysisId: gap.id, status: res.status, errText: errText.slice(0, 500) } },
    });
    return null;
  }

  try {
    return await readAndMergeWorkerStream(res.body, gap);
  } finally {
    clearTimeout(streamingTimeoutId);
  }
}

/**
 * Reads the worker's SSE response body and merges its fragments into one
 * chunk-shaped object. Split out of collectDimensionsFromWorker so that
 * function stays to request-construction + fetch-with-timeout, and this one
 * owns only stream decoding/merging -- CodeFactor flagged the unsplit
 * version as high-complexity, and the two concerns (network call lifecycle
 * vs. wire-format parsing) were genuinely separable, not artificially split.
 *
 * Field mapping here MUST match UCISStreamFragmentSchema
 * (web/lib/validators/synthesis.ts) exactly -- the wire shape is NOT the
 * same as UCISPayloadV2's persisted shape. A dimension fragment carries the
 * dimension NUMBER in a field literally named `dimension` plus separate
 * `name`/`content` fields -- stitchChunksIntoPayload needs a dimension
 * OBJECT ({number, name, content}), so it has to be reassembled here, not
 * passed through as the bare number. persona's payload field is `config`,
 * classification's is `data`, and knowledge graph arrives as `kg` with
 * top-level `nodes`/`edges`/`rootId` (not a nested `knowledgeGraph` object).
 * There is no `monetizationVerdict` stream fragment type at all -- it's a
 * UCISPayloadV2 persisted-payload field, never emitted on the wire, so
 * there is nothing to merge from a fresh worker call.
 */
async function readAndMergeWorkerStream(body: ReadableStream<Uint8Array>, gap: AnalysisGap): Promise<Record<string, unknown> | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let skippedFragmentCount = 0;
  const chunk: Record<string, unknown> = { dimensions: [] as unknown[] };

  const mergeFragment = (frag: Record<string, unknown>) => {
    if (frag.type === 'dimension' && typeof frag.dimension === 'number' && typeof frag.content === 'string') {
      (chunk.dimensions as unknown[]).push({ number: frag.dimension, name: frag.name ?? `Dimension ${frag.dimension}`, content: frag.content });
    } else if (frag.type === 'persona' && frag.config) {
      chunk.persona = frag.config;
    } else if (frag.type === 'classification' && frag.data) {
      chunk.classification = frag.data;
    } else if (frag.type === 'kg' && Array.isArray(frag.nodes)) {
      chunk.knowledgeGraph = { nodes: frag.nodes, edges: frag.edges ?? [], rootId: frag.rootId ?? null };
    }
  };

  const handleEvent = (rawEvent: string) => {
    const trimmed = rawEvent.trim();
    if (!trimmed || !trimmed.startsWith('data:')) return;
    const jsonStr = trimmed.slice(5).trim();
    if (!jsonStr || jsonStr === '[DONE]') return;
    try {
      mergeFragment(JSON.parse(jsonStr));
    } catch (parseErr) {
      skippedFragmentCount++;
      console.warn('[dimension-remediation] unparseable SSE fragment, skipping', { analysisId: gap.id, err: parseErr instanceof Error ? parseErr.message : String(parseErr) });
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) handleEvent(event);
    }
    if (buffer.trim()) handleEvent(buffer);
  } catch (err) {
    reportAbortableError(err, 'sse_read', gap.id, '[dimension-remediation] SSE read aborted or failed');
    return null;
  }

  if (skippedFragmentCount > 0) {
    console.warn('[dimension-remediation] some SSE fragments were unparseable', { analysisId: gap.id, skippedFragmentCount });
    Sentry.captureMessage('dimension-remediation: unparseable SSE fragments', {
      level: 'warning',
      contexts: {
        remediation: {
          analysisId: gap.id,
          skippedFragmentCount,
        },
      },
    });
  }

  return (chunk.dimensions as unknown[]).length > 0 ? chunk : null;
}

/**
 * Remediate a single gap: reserve its estimated cost from the token bucket
 * (atomic, fails closed), call the worker for just the missing dimensions,
 * stitch the result in with the existing content, persist if it actually
 * improved the analysis. The final write is guarded on
 * `billing_status = 'failed'` so a concurrent legitimate "Re-analyze" (which
 * would move the row to `processing` then `completed`) always wins -- this
 * is the sole per-row race guard; there is no run-level mutex anymore (ADR
 * 019) -- the token bucket's atomicity is what prevents overlapping callers
 * from double-spending the same budget, not a lock on the harness itself.
 */
export async function remediateAnalysis(
  gap: AnalysisGap,
  models: string[],
  cascade: Array<{ model: string; name: string; cost?: number; providerOrder?: string[] }>,
  budget: { capacityCents: number; refillRatePerMsCents: number; costPer1K: number }
): Promise<RemediationResult> {
  const estimatedCostCents = estimateCostCents(gap.missingDimensions.length, budget.costPer1K);
  const affordable = await tryConsumeTokenBucket(TOKEN_BUCKET_KEY, budget.capacityCents, budget.refillRatePerMsCents, estimatedCostCents);
  if (!affordable) {
    return { analysisId: gap.id, stage: RemediationStage.BudgetExhausted, dimensionsRequested: gap.missingDimensions };
  }

  const persistenceAdapter = new SupabasePersistenceAdapter();

  const newChunk = await collectDimensionsFromWorker(gap, models, cascade);
  if (!newChunk) {
    return { analysisId: gap.id, stage: RemediationStage.WorkerFailed, dimensionsRequested: gap.missingDimensions };
  }

  // Existing content, wrapped as a "chunk" so stitchChunksIntoPayload's
  // existing merge-by-map logic can combine it with the newly-generated one
  // without any new merge code. The map keys (1, 2) aren't dimension
  // numbers -- they're arbitrary chunk-slot indices, same as bundle-stream
  // indices are in the live 5-way merge; stitchChunksIntoPayload only ever
  // iterates 1..resolvedTotal to visit each slot once.
  const EXISTING_SLOT = 1;
  const NEW_SLOT = 2;
  const existingChunk: Record<string, unknown> = gap.analysisPayload
    ? gap.analysisPayload
    : { dimensions: Object.values(parseToUCISDimensions(gap.analysisMarkdown)) };

  const chunkMap = new Map<number, unknown>([
    [EXISTING_SLOT, existingChunk],
    [NEW_SLOT, newChunk],
  ]);
  const stitchResult = stitchChunksIntoPayload(chunkMap, 2);
  if (!stitchResult.payload) {
    Sentry.captureMessage('dimension-remediation: stitch produced no payload', {
      level: 'error',
      contexts: { remediation: { analysisId: gap.id } },
    });
    return { analysisId: gap.id, stage: RemediationStage.StitchFailed, dimensionsRequested: gap.missingDimensions };
  }

  const { dimensionStatus, validationStatus, billingStatus } = buildDimensionStatus(stitchResult.payload);
  const dimensionCountAfter = dimensionStatus.filter((d) => d.status === 'done').length;
  const nowIso = new Date().toISOString();
  const isStillPartial = dimensionCountAfter < TOTAL_DIMENSIONS;
  const existingReport = asReportObject(gap.validationReport);
  const currentRetryCount = typeof existingReport.remediation_retry_count === 'number' ? existingReport.remediation_retry_count : 0;

  const newReport = {
    ...existingReport,
    validation_status: validationStatus,
    status: validationStatus,
    billing_status: billingStatus,
    dimension_status: dimensionStatus,
    valid: stitchResult.validationPassed && validationStatus === 'done',
    remediated: true,
    remediated_at: nowIso,
    remediated_dimensions: gap.missingDimensions,
    // Increment retry counter only if still partial, to bound retries on
    // persistently failing rows
    remediation_retry_count: isStillPartial ? currentRetryCount + 1 : currentRetryCount,
  };

  const { updated } = await persistenceAdapter.updateAnalysisResult({
    analysisId: gap.id,
    markdown: stitchResult.markdown,
    payload: stitchResult.payload,
    model: null,
    validationPassed: stitchResult.validationPassed,
    validationReport: newReport,
    guardBillingStatus: 'failed',
  });
  if (!updated) {
    // Guarded write lost to a concurrent legitimate change (e.g. a
    // "Re-analyze" that moved the row off billing_status='failed' since this
    // gap was found). The row is no longer a remediation candidate -- nothing
    // to retry.
    return { analysisId: gap.id, stage: RemediationStage.PersistRaced, dimensionsRequested: gap.missingDimensions };
  }

  return {
    analysisId: gap.id,
    stage: dimensionCountAfter >= TOTAL_DIMENSIONS ? RemediationStage.Remediated : RemediationStage.StillPartial,
    dimensionsRequested: gap.missingDimensions,
    dimensionCountAfter,
  };
}

/**
 * Harness (ADR 019): owns budget-gated pacing, not run-level mutual
 * exclusion. There is no lock -- the token bucket's own atomicity is what
 * prevents overlapping invocations from double-spending, so overlapping
 * calls are safe by construction rather than something a lock has to
 * prevent. This is what lets throughput scale with backlog size: an empty
 * bucket naturally self-throttles (BudgetExhausted stops the loop early,
 * cheaply, without an error), a full one processes as many candidates as
 * it can afford in one pass -- never a fixed "N every tick" regardless of
 * whether the backlog is 45 or 4,500.
 *
 * Candidate order alternates oldest-first/newest-first each invocation
 * ("pendulum", ADR 019) via a Redis counter, so neither a long-stuck row
 * nor a fresh failure is ever permanently starved.
 *
 * The model cascade is resolved once per harness run, not once per
 * candidate -- it doesn't vary within a run, so resolving it inside the
 * per-candidate path would just be N redundant identical config reads.
 */
export async function runRemediationHarness(): Promise<RemediationSweepResult> {
  const budget = await resolveBudgetParams();
  if (!budget.enabled) {
    console.log('[dimension-remediation] disabled via remediation.enabled, skipping');
    return { scanned: 0, remediated: 0, stillPartial: 0, skipped: 0, errored: 0, budgetExhausted: false, disabled: true };
  }

  const pendulumTick = await incrementRedisValue(PENDULUM_COUNTER_KEY);
  const order = pendulumTick % 2 === 0 ? 'asc' : 'desc';

  const gaps = await findAnalysesWithMissingDimensions({ order, maxRetries: budget.maxRetries });
  const result: RemediationSweepResult = { scanned: gaps.length, remediated: 0, stillPartial: 0, skipped: 0, errored: 0, budgetExhausted: false, disabled: false };
  if (gaps.length === 0) return result;

  const cascade = await resolveAnalysisCascade();
  const models = cascade.map((c) => c.model);
  const budgetWithCost = { ...budget, costPer1K: cheapestCostPer1K(cascade) };

  for (const gap of gaps) {
    try {
      const outcome = await remediateAnalysis(gap, models, cascade, budgetWithCost);
      console.log('[dimension-remediation] candidate processed', { analysisId: gap.id, stage: outcome.stage, order });
      switch (outcome.stage) {
        case RemediationStage.Remediated:
          result.remediated++;
          break;
        case RemediationStage.StillPartial:
          result.stillPartial++;
          break;
        case RemediationStage.PersistRaced:
          result.skipped++;
          break;
        case RemediationStage.BudgetExhausted:
          result.budgetExhausted = true;
          console.log('[dimension-remediation] budget exhausted, stopping this cycle', { processed: result.remediated + result.stillPartial + result.skipped + result.errored, scanned: gaps.length });
          return result; // stop the loop -- no point checking remaining candidates, the bucket won't refill mid-cycle
        default:
          result.errored++;
      }
    } catch (err) {
      Sentry.captureException(err, {
        contexts: {
          remediation: {
            service: 'dimension-remediation',
            analysisId: gap.id,
          },
        },
      });
      result.errored++;
    }
  }
  return result;
}
