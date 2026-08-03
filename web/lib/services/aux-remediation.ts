/**
 * Aux Remediation (channelMeta/comments recovery for dimension-complete analyses)
 *
 * The product owner's explicit design principle: an analysis is only truly
 * "complete" when it has all TOTAL_DIMENSIONS dimensions AND channelMeta AND
 * comments -- billing_status='completed' must mean the FULL set is present,
 * not dimension-completeness alone (RCA 2026-08: 11 real prod rows had to be
 * manually reverted from 'completed' back to 'failed' after being marked
 * complete on dimensions alone while missing both aux pieces).
 *
 * dimension-remediation.ts's findAnalysesWithMissingDimensions() queries
 * exactly this population (billing_status='failed' AND
 * validation_report.status='partial') but explicitly SKIPS any row where
 * computeMissingDimensions() returns empty -- the 11-dims-done-but-aux-missing
 * case matches its query and then falls into a silent no-op, with no
 * remediation path at all. This module is that missing path.
 *
 * Deliberately a SEPARATE, narrower harness rather than folded into
 * dimension-remediation.ts's gap type (see PR description for the full
 * reasoning): channelMeta and comments are YouTube Data API / scrape calls,
 * not LLM generation -- zero OpenRouter spend, so none of ADR 019's
 * dollar-denominated token-bucket budget gating applies here. Reusing the
 * LLM-oriented /analyze-llm-stream worker call for an aux-only gap would
 * either do nothing (an empty `dimensions` array produces no text, and
 * atomicPersist's `hasContent` gate means its S2S persist -- the only place
 * channelMeta/comments reach Postgres in that flow -- would never fire) or
 * force wasteful, unnecessary LLM regeneration of dimensions that are
 * already complete just to trigger that side effect. Two genuinely
 * different cost models, two harnesses.
 *
 * Single write path, reused (not reinvented): every persisted change here
 * goes through SupabasePersistenceAdapter.updateAnalysisResult ->
 * update_analysis_result_atomic, the SAME RPC dimension-remediation.ts and
 * the live persist route already use for every billing_status write in this
 * codebase. This harness never writes billing_status via a raw `.update()`
 * call -- doing so would create a second, diverging source of truth for a
 * billing-adjacent column, exactly the class of bug this whole effort exists
 * to close.
 *
 * Comments are inherently asynchronous: the existing Tier 3 pipeline
 * (worker/src/queue-consumers/comments-tier3.ts) does a paginated fetch that
 * can take up to tens of seconds and reports back via a separate S2S
 * callback (/api/comments/persist-sample-run) once done -- there is no
 * synchronous "fetch comments now" call to make. This harness enqueues that
 * job (system-triggered, no credit-wallet debit -- see
 * enqueueSystemCommentsBackfill's own comment for why bypassing
 * /api/comments/tier3/start's user-charged flow is correct here) and defers
 * to the callback + a later sweep to observe completion: a row whose only
 * gap was comments will show up again on the NEXT sweep already
 * aux-complete (the callback will have landed analysis_payload.comments by
 * then) and this harness will simply flip billing_status to 'completed'
 * with no further fetch needed.
 */
import * as Sentry from '@sentry/nextjs';

import { getSupabaseServiceClient } from '@/lib/supabase';
import { env } from '@/lib/env';
import { signChannelMetaToken, signCommentsTier3Token } from '@/lib/stream-token';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';
import { auxStatusFromAnalysisPayload, type AuxStatusPayloadInput } from '@/lib/utils/aux-status-from-report';

export enum AuxRemediationStage {
  /** Row was already aux-complete (or became so this call) -- billing_status flipped to 'completed'. */
  Completed = 'completed',
  /** channelMeta was fetched and merged, but comments are still missing/pending -- not yet fully complete. */
  ChannelMetaBackfilled = 'channel_meta_backfilled',
  /** Comments Tier 3 fetch was enqueued (async); nothing else to do this pass. */
  CommentsBackfillEnqueued = 'comments_backfill_enqueued',
  /** channelId could not be resolved, or the worker fetch failed. */
  ChannelMetaFetchFailed = 'channel_meta_fetch_failed',
  CommentsEnqueueFailed = 'comments_enqueue_failed',
  /** A concurrent legitimate write (e.g. Re-analyze) moved the row off billing_status='failed'. */
  PersistRaced = 'persist_raced',
  /** Retry budget exhausted -- permanently unrecoverable, reported not silently skipped. */
  Unrecoverable = 'unrecoverable',
}

const REMEDIATION_MAX_RETRIES = 3;
const CHANNEL_META_FETCH_TIMEOUT_MS = 8_000;
const COMMENTS_ENQUEUE_TIMEOUT_MS = 10_000;

export interface AuxGap {
  id: string;
  userId: string;
  videoId: string;
  billingStatus: string;
  /** Preserved verbatim and passed back through on persist -- update_analysis_result_atomic sets analysis_markdown unconditionally (not coalesced), so a caller that omits it would wipe existing content. */
  markdown: string;
  analysisPayload: Record<string, unknown> | null;
  validationReport: unknown;
  dimensionsComplete: boolean;
  hasChannelMeta: boolean;
  hasComments: boolean;
}

export interface AuxRemediationResult {
  analysisId: string;
  stage: AuxRemediationStage;
  reason?: string;
}

export interface AuxRemediationSweepResult {
  scanned: number;
  completed: number;
  partiallyBackfilled: number;
  commentsEnqueued: number;
  unrecoverable: number;
  skipped: number;
  errored: number;
}

function asReportObject(report: unknown): Record<string, unknown> {
  return report && typeof report === 'object' && !Array.isArray(report) ? (report as Record<string, unknown>) : {};
}

/**
 * Pure: does this markdown have all TOTAL_DIMENSIONS dimensions present?
 * Reuses the same UCIS parser dimension-remediation.ts's
 * computeMissingDimensions does, kept as a tiny local predicate rather than
 * importing that function's list-returning shape for a single boolean use.
 */
export function dimensionsAreComplete(markdown: string): boolean {
  const parsed = parseToUCISDimensions(markdown);
  return Object.keys(parsed).length >= TOTAL_DIMENSIONS;
}

/**
 * Pure: classify a single row's aux status from its already-fetched
 * markdown/payload. Exported for unit testing without a live Supabase
 * connection, same pattern as dimension-remediation.ts's
 * computeMissingDimensions.
 */
export function classifyAuxGap(row: {
  id: string;
  userId: string;
  videoId: string;
  billingStatus: string;
  markdown: string;
  analysisPayload: Record<string, unknown> | null;
  validationReport: unknown;
}): AuxGap {
  const dimensionsComplete = dimensionsAreComplete(row.markdown);
  const auxStatus = auxStatusFromAnalysisPayload(row.analysisPayload as AuxStatusPayloadInput | null);
  return {
    id: row.id,
    userId: row.userId,
    videoId: row.videoId,
    billingStatus: row.billingStatus,
    markdown: row.markdown,
    analysisPayload: row.analysisPayload,
    validationReport: row.validationReport,
    dimensionsComplete,
    hasChannelMeta: auxStatus.hasChannelMeta,
    hasComments: auxStatus.hasComments,
  };
}

/**
 * Find analyses whose 11 dimensions are done but channelMeta and/or
 * comments are missing -- the exact population
 * findAnalysesWithMissingDimensions() silently drops today. Deliberately
 * narrow to `billing_status = 'failed'`: a row already 'completed' is, by
 * this same design principle, never missing aux (or it would never have
 * been marked complete in the first place going forward) -- and this
 * harness's job is recovery of stuck rows, not a full-table re-audit.
 */
export async function findAnalysesWithMissingAux(opts?: { limit?: number }): Promise<AuxGap[]> {
  const limit = opts?.limit ?? 100;
  const service = getSupabaseServiceClient();

  const { data, error } = await service
    .from('analyses')
    .select('id, video_id, analysis_markdown, analysis_payload, validation_report, billing_status, user_id')
    .eq('billing_status', 'failed')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const gaps: AuxGap[] = [];
  for (const row of data ?? []) {
    const markdown = (row as { analysis_markdown?: string }).analysis_markdown ?? '';
    if (!markdown.trim()) continue; // total loss, not this harness's scope

    const report = (row as { validation_report?: unknown }).validation_report;
    const reportObj = asReportObject(report);
    const retryCount = typeof reportObj.aux_remediation_retry_count === 'number' ? reportObj.aux_remediation_retry_count : 0;
    if (retryCount >= REMEDIATION_MAX_RETRIES) continue; // reported as unrecoverable by the caller once found, not re-attempted forever

    const gap = classifyAuxGap({
      id: (row as { id: string }).id,
      userId: (row as { user_id: string }).user_id,
      videoId: (row as { video_id: string }).video_id,
      billingStatus: (row as { billing_status: string }).billing_status,
      markdown,
      analysisPayload: (row as { analysis_payload?: Record<string, unknown> | null }).analysis_payload ?? null,
      validationReport: report,
    });

    // Not this harness's population: dims not done (dimension-remediation.ts's
    // job) or aux already fully present (nothing to remediate -- a row like
    // this is either already correctly 'completed' upstream, or a genuinely
    // different failure this harness shouldn't touch).
    if (!gap.dimensionsComplete) continue;
    if (gap.hasChannelMeta && gap.hasComments) continue;

    gaps.push(gap);
  }
  return gaps;
}

/**
 * Resolve channelId from the video itself and fetch channelMeta via the
 * worker's standalone /channel-meta/fetch route (worker/src/routes/
 * channel-meta.ts). Synchronous, cheap (YouTube Data API + Decodo scrape,
 * no LLM), single HTTP round-trip.
 */
async function fetchChannelMetaViaWorker(gap: AuxGap): Promise<{ channelMeta: Record<string, unknown> | null } | null> {
  const token = await signChannelMetaToken(gap.id, gap.videoId);
  try {
    const res = await fetch(`${env.cloudflareWorkerUrl}/channel-meta/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: gap.videoId, analysisId: gap.id, sig: token.sig, exp: token.exp }),
      signal: AbortSignal.timeout(CHANNEL_META_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[aux-remediation] channel-meta fetch non-2xx', { analysisId: gap.id, status: res.status });
      return null;
    }
    const body = (await res.json()) as { channelMeta?: Record<string, unknown> | null };
    return { channelMeta: body.channelMeta ?? null };
  } catch (err) {
    console.error('[aux-remediation] channel-meta fetch threw', { analysisId: gap.id, err: err instanceof Error ? err.message : String(err) });
    Sentry.captureException(err, { contexts: { auxRemediation: { service: 'aux-remediation', phase: 'channel_meta_fetch', analysisId: gap.id } } });
    return null;
  }
}

/**
 * Enqueue a system-triggered Tier 3 comments fetch, bypassing
 * /api/comments/tier3/start's user-charged flow. That route requires an
 * authenticated user session (there is none in a cron/harness context) and
 * debits the user's credit wallet -- correct for a user-requested uncapped
 * sample, wrong here: this backfill exists because the product's OWN design
 * principle wasn't enforced at write time, not because the user is choosing
 * to spend credits on a bigger sample. Creates the same comment_sample_runs
 * row and calls the same worker enqueue endpoint directly with the
 * service-role client, at zero cost to the user's wallet.
 */
async function enqueueSystemCommentsBackfill(gap: AuxGap): Promise<boolean> {
  const service = getSupabaseServiceClient();
  const reportObj = asReportObject(gap.validationReport);
  const rawCount = (reportObj.metadata as Record<string, unknown> | undefined)?.commentCount;
  const totalCommentCount = typeof rawCount === 'number' ? rawCount : typeof rawCount === 'string' ? parseInt(rawCount, 10) || 0 : 0;
  if (totalCommentCount <= 0) {
    console.warn('[aux-remediation] no known commentCount, skipping comments backfill enqueue', { analysisId: gap.id });
    return false;
  }

  const { data: runRow, error: insertError } = await service
    .from('comment_sample_runs')
    .insert({
      analysis_id: gap.id,
      user_id: gap.userId,
      tier: 3,
      total_comment_count: totalCommentCount,
      requested_percent: 100,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertError || !runRow) {
    console.error('[aux-remediation] comment_sample_runs insert failed', { analysisId: gap.id, err: insertError?.message });
    return false;
  }

  const token = await signCommentsTier3Token(runRow.id, gap.userId);
  try {
    const res = await fetch(`${env.cloudflareWorkerUrl}/comments/tier3/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleRunId: runRow.id,
        videoId: gap.videoId,
        userId: gap.userId,
        totalCommentCount,
        appUrl: env.appUrl || 'https://yt-intel.getmytestdrive.com',
        sig: token.sig,
        exp: token.exp,
      }),
      signal: AbortSignal.timeout(COMMENTS_ENQUEUE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Worker enqueue returned ${res.status}`);
    return true;
  } catch (err) {
    console.error('[aux-remediation] comments-tier3 enqueue failed', { analysisId: gap.id, err: err instanceof Error ? err.message : String(err) });
    Sentry.captureException(err, { contexts: { auxRemediation: { service: 'aux-remediation', phase: 'comments_enqueue', analysisId: gap.id } } });
    return false;
  }
}

/**
 * Remediate a single aux gap. Guarded on `billing_status = 'failed'` via
 * updateAnalysisResult's guardBillingStatus, the same per-row race guard
 * dimension-remediation.ts's remediateAnalysis uses -- a concurrent
 * legitimate Re-analyze always wins.
 */
export async function remediateAuxGap(gap: AuxGap): Promise<AuxRemediationResult> {
  const persistenceAdapter = new SupabasePersistenceAdapter();
  const existingReport = asReportObject(gap.validationReport);
  const currentRetryCount = typeof existingReport.aux_remediation_retry_count === 'number' ? existingReport.aux_remediation_retry_count : 0;

  let payload = gap.analysisPayload ?? {};
  let channelMetaFetchFailed = false;
  let commentsEnqueueFailed = false;
  let commentsEnqueued = false;

  if (!gap.hasChannelMeta) {
    const result = await fetchChannelMetaViaWorker(gap);
    if (result?.channelMeta) {
      payload = { ...payload, channelMeta: result.channelMeta };
    } else {
      channelMetaFetchFailed = true;
    }
  }

  const nowHasComments = gap.hasComments; // this pass never synchronously gets comments -- only ever enqueues
  if (!nowHasComments) {
    commentsEnqueued = await enqueueSystemCommentsBackfill(gap);
    commentsEnqueueFailed = !commentsEnqueued;
  }

  const nowHasChannelMeta = gap.hasChannelMeta || Boolean((payload as { channelMeta?: unknown }).channelMeta);
  const isFullyComplete = nowHasChannelMeta && nowHasComments;
  const nowIso = new Date().toISOString();

  const newReport = {
    ...existingReport,
    aux_remediated_at: nowIso,
    aux_remediation_retry_count: isFullyComplete ? currentRetryCount : currentRetryCount + 1,
    ...(isFullyComplete
      ? { status: 'done', billing_status: 'completed' }
      : {}),
  };

  const { updated } = await persistenceAdapter.updateAnalysisResult({
    analysisId: gap.id,
    markdown: gap.markdown, // preserved verbatim -- the RPC sets analysis_markdown unconditionally, never coalesced
    payload: (payload as any),
    model: null,
    validationPassed: isFullyComplete,
    validationReport: newReport,
    guardBillingStatus: 'failed',
  }).catch((err) => {
    Sentry.captureException(err, { contexts: { auxRemediation: { service: 'aux-remediation', phase: 'persist', analysisId: gap.id } } });
    return { updated: false };
  });

  if (!updated) {
    return { analysisId: gap.id, stage: AuxRemediationStage.PersistRaced };
  }

  if (isFullyComplete) {
    return { analysisId: gap.id, stage: AuxRemediationStage.Completed };
  }
  if (currentRetryCount + 1 >= REMEDIATION_MAX_RETRIES) {
    const reason = channelMetaFetchFailed && commentsEnqueueFailed
      ? 'channelMeta fetch and comments enqueue both failed repeatedly'
      : channelMetaFetchFailed
        ? 'channelMeta fetch failed repeatedly (video/channel may be deleted or private)'
        : 'comments backfill could not be enqueued repeatedly';
    return { analysisId: gap.id, stage: AuxRemediationStage.Unrecoverable, reason };
  }
  if (commentsEnqueued) {
    return { analysisId: gap.id, stage: AuxRemediationStage.CommentsBackfillEnqueued };
  }
  if (nowHasChannelMeta && !gap.hasChannelMeta) {
    return { analysisId: gap.id, stage: AuxRemediationStage.ChannelMetaBackfilled };
  }
  if (channelMetaFetchFailed) {
    return { analysisId: gap.id, stage: AuxRemediationStage.ChannelMetaFetchFailed, reason: 'channelMeta fetch failed' };
  }
  return { analysisId: gap.id, stage: AuxRemediationStage.CommentsEnqueueFailed, reason: 'comments enqueue failed' };
}

/**
 * Harness entry point (mirrors dimension-remediation.ts's
 * runRemediationHarness structure, minus ADR 019 budget gating -- there is
 * no LLM spend here to pace).
 */
export async function runAuxRemediationHarness(): Promise<AuxRemediationSweepResult> {
  const gaps = await findAnalysesWithMissingAux();
  const result: AuxRemediationSweepResult = { scanned: gaps.length, completed: 0, partiallyBackfilled: 0, commentsEnqueued: 0, unrecoverable: 0, skipped: 0, errored: 0 };

  for (const gap of gaps) {
    try {
      const outcome = await remediateAuxGap(gap);
      console.log('[aux-remediation] candidate processed', { analysisId: gap.id, stage: outcome.stage, reason: outcome.reason });
      switch (outcome.stage) {
        case AuxRemediationStage.Completed:
          result.completed++;
          break;
        case AuxRemediationStage.ChannelMetaBackfilled:
          result.partiallyBackfilled++;
          break;
        case AuxRemediationStage.CommentsBackfillEnqueued:
          result.commentsEnqueued++;
          break;
        case AuxRemediationStage.Unrecoverable:
          result.unrecoverable++;
          Sentry.captureMessage('aux-remediation: analysis permanently unrecoverable', {
            level: 'warning',
            contexts: { auxRemediation: { analysisId: gap.id, reason: outcome.reason } },
          });
          break;
        case AuxRemediationStage.PersistRaced:
          result.skipped++;
          break;
        default:
          result.errored++;
      }
    } catch (err) {
      Sentry.captureException(err, { contexts: { auxRemediation: { service: 'aux-remediation', analysisId: gap.id } } });
      result.errored++;
    }
  }
  return result;
}
