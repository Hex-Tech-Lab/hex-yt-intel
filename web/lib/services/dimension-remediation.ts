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
 */
import * as Sentry from '@sentry/nextjs';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { env } from '@/lib/env';
import { signStreamToken } from '@/lib/stream-token';
import { resolveAnalysisCascade } from '@/lib/config/cascade';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';
import { stitchChunksIntoPayload, buildDimensionStatus } from '@/lib/services/stitch-analysis-chunks';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

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
  outcome: 'remediated' | 'still_partial' | 'skipped_raced' | 'worker_error' | 'stitch_failed';
  dimensionsRequested: number[];
  dimensionCountAfter?: number;
}

export interface RemediationSweepResult {
  scanned: number;
  remediated: number;
  stillPartial: number;
  skipped: number;
  errored: number;
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
  limit?: number;
}): Promise<AnalysisGap[]> {
  const limit = opts?.limit ?? 10;
  const service = getSupabaseServiceClient();

  const { data, error } = await service
    .from('analyses')
    .select('id, video_id, title, channel_title, analysis_markdown, analysis_payload, validation_report, billing_status')
    .eq('billing_status', 'failed')
    .eq('validation_report->>status', 'partial')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const gaps: AnalysisGap[] = [];
  for (const row of data ?? []) {
    const markdown = (row as { analysis_markdown?: string }).analysis_markdown ?? '';
    if (!markdown.trim()) continue; // total loss -- only a full re-run helps, not this path

    const parsed = parseToUCISDimensions(markdown);
    const completedDimensions = Object.keys(parsed).map(Number);
    if (completedDimensions.length >= TOTAL_DIMENSIONS) continue; // shouldn't happen given the status filter, but never remediate a row that's actually already whole

    const missingDimensions: number[] = [];
    for (let d = 1; d <= TOTAL_DIMENSIONS; d++) {
      if (!completedDimensions.includes(d)) missingDimensions.push(d);
    }

    const report = (row as { validation_report?: unknown }).validation_report;
    const reportMetadata =
      report && typeof report === 'object' && !Array.isArray(report)
        ? ((report as Record<string, unknown>).metadata as Record<string, unknown> | undefined)
        : undefined;

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
 * Consume the worker's SSE stream server-side (no browser present in a cron
 * context) and accumulate the JSON fragments into one chunk-shaped payload,
 * matching what a single bundle stream produces for stitchChunksIntoPayload.
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

  const res = await fetch(`${env.cloudflareWorkerUrl}/analyze-llm-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    console.error('[dimension-remediation] worker call failed', { analysisId: gap.id, status: res.status, errText: errText.slice(0, 500) });
    Sentry.captureMessage('dimension-remediation: worker non-2xx response', {
      level: 'error',
      contexts: { remediation: { analysisId: gap.id, status: res.status, errText: errText.slice(0, 500) } },
    });
    return null;
  }

  // The worker emits newline-delimited SSE `data: {...}` frames, each a
  // fragment (dimension / persona / classification / monetizationVerdict /
  // knowledgeGraph piece) -- same shape a browser's useSSEStream parses.
  // Collected fragments are merged into one chunk-shaped object.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const chunk: Record<string, unknown> = { dimensions: [] as unknown[] };

  const mergeFragment = (frag: Record<string, unknown>) => {
    if (frag.type === 'dimension' && frag.dimension) {
      (chunk.dimensions as unknown[]).push(frag.dimension);
    } else if (frag.type === 'persona' && frag.persona) {
      chunk.persona = frag.persona;
    } else if (frag.type === 'classification' && frag.classification) {
      chunk.classification = frag.classification;
    } else if (frag.type === 'monetizationVerdict' && frag.monetizationVerdict) {
      chunk.monetizationVerdict = frag.monetizationVerdict;
    } else if (frag.type === 'knowledgeGraph' && frag.knowledgeGraph) {
      chunk.knowledgeGraph = frag.knowledgeGraph;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        mergeFragment(JSON.parse(jsonStr));
      } catch (parseErr) {
        console.warn('[dimension-remediation] unparseable SSE fragment, skipping', { analysisId: gap.id, err: parseErr instanceof Error ? parseErr.message : String(parseErr) });
      }
    }
  }

  return (chunk.dimensions as unknown[]).length > 0 ? chunk : null;
}

/**
 * Remediate a single gap: call the worker for just the missing dimensions,
 * stitch the result in with the existing content, persist if it actually
 * improved the analysis. Idempotent and race-safe: re-checks the gap still
 * exists before calling the worker, and guards the final write on
 * `billing_status = 'failed'` so a concurrent legitimate "Re-analyze" (which
 * would move the row to `processing` then `completed`) always wins.
 */
export async function remediateAnalysis(gap: AnalysisGap): Promise<RemediationResult> {
  const service = getSupabaseServiceClient();
  const persistenceAdapter = new SupabasePersistenceAdapter();

  // Re-check: another remediation tick or the user's own Re-analyze could
  // have already resolved this since the sweep query ran.
  const { data: current, error: fetchErr } = await service
    .from('analyses')
    .select('billing_status')
    .eq('id', gap.id)
    .maybeSingle();
  if (fetchErr) {
    Sentry.captureException(fetchErr, { tags: { service: 'dimension-remediation' }, extra: { analysisId: gap.id } });
    return { analysisId: gap.id, outcome: 'worker_error', dimensionsRequested: gap.missingDimensions };
  }
  if (!current || current.billing_status !== 'failed') {
    return { analysisId: gap.id, outcome: 'skipped_raced', dimensionsRequested: gap.missingDimensions };
  }

  const cascade = await resolveAnalysisCascade();
  const models = cascade.map((c) => c.model);

  const newChunk = await collectDimensionsFromWorker(gap, models, cascade);
  if (!newChunk) {
    return { analysisId: gap.id, outcome: 'worker_error', dimensionsRequested: gap.missingDimensions };
  }

  // Existing content, wrapped as a "chunk" so stitchChunksIntoPayload's
  // existing merge-by-map logic can combine it with the newly-generated one
  // without any new merge code.
  const existingChunk: Record<string, unknown> = gap.analysisPayload
    ? gap.analysisPayload
    : { dimensions: Object.values(parseToUCISDimensions(gap.analysisMarkdown)) };

  const chunkMap = new Map<number, unknown>([
    [1, existingChunk],
    [2, newChunk],
  ]);
  const stitchResult = stitchChunksIntoPayload(chunkMap, 2);
  if (!stitchResult.payload) {
    Sentry.captureMessage('dimension-remediation: stitch produced no payload', {
      level: 'error',
      contexts: { remediation: { analysisId: gap.id } },
    });
    return { analysisId: gap.id, outcome: 'stitch_failed', dimensionsRequested: gap.missingDimensions };
  }

  const { dimensionStatus, validationStatus, billingStatus } = buildDimensionStatus(stitchResult.payload);
  const dimensionCountAfter = dimensionStatus.filter((d) => d.status === 'done').length;
  const nowIso = new Date().toISOString();
  const baseReport =
    gap.validationReport && typeof gap.validationReport === 'object' && !Array.isArray(gap.validationReport)
      ? (gap.validationReport as Record<string, unknown>)
      : {};
  const newReport = {
    ...baseReport,
    validation_status: validationStatus,
    status: validationStatus,
    billing_status: billingStatus,
    dimension_status: dimensionStatus,
    valid: stitchResult.validationPassed && validationStatus === 'done',
    remediated: true,
    remediated_at: nowIso,
    remediated_dimensions: gap.missingDimensions,
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
    return { analysisId: gap.id, outcome: 'skipped_raced', dimensionsRequested: gap.missingDimensions };
  }

  return {
    analysisId: gap.id,
    outcome: dimensionCountAfter >= TOTAL_DIMENSIONS ? 'remediated' : 'still_partial',
    dimensionsRequested: gap.missingDimensions,
    dimensionCountAfter,
  };
}

/** Sweep and remediate a batch of gaps. Safe to run repeatedly. */
export async function sweepMissingDimensions(opts?: { limit?: number }): Promise<RemediationSweepResult> {
  const gaps = await findAnalysesWithMissingDimensions(opts);
  const result: RemediationSweepResult = { scanned: gaps.length, remediated: 0, stillPartial: 0, skipped: 0, errored: 0 };

  for (const gap of gaps) {
    try {
      const outcome = await remediateAnalysis(gap);
      if (outcome.outcome === 'remediated') result.remediated++;
      else if (outcome.outcome === 'still_partial') result.stillPartial++;
      else if (outcome.outcome === 'skipped_raced') result.skipped++;
      else result.errored++;
    } catch (err) {
      Sentry.captureException(err, { tags: { service: 'dimension-remediation' }, extra: { analysisId: gap.id } });
      result.errored++;
    }
  }
  return result;
}
