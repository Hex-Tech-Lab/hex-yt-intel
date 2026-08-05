export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { verifyContentSig } from '@/lib/stream-token';
import { UCISPayloadV2Schema } from '@/lib/validators/synthesis';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';
import { setAnalysisCache, generateCacheKey, type CachedAnalysisResult } from '@/lib/services/cache';
import { publishValidationTask, publishDigestTask } from '@/lib/qstash-client';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { SupabaseTranscriptAdapter } from '@/lib/adapters/SupabaseTranscriptAdapter';
import * as Sentry from '@sentry/nextjs';
import { PersistedValidationReport, ValidationReportStatus, isPersistedValidationReport } from '@/lib/types/validation-report';
import { z } from 'zod';
import { TOTAL_DIMENSIONS, TOTAL_STREAMS } from '@/lib/config/synthesis';
import { WorkflowConductor } from '@/lib/services/WorkflowConductor';
import { ERROR_PHASES } from '@/lib/error-codes';
import { categorizeError, createErrorResponse } from '@/lib/services/error-handler';
import { stitchChunksIntoPayload, buildDimensionStatus, resolveBillingStatus } from '@/lib/services/stitch-analysis-chunks';
import { PostgresBillingAdapter } from '@/lib/adapters/PostgresBillingAdapter';
import { getUserTier } from '@/lib/services/traffic';

/** Calculate exponential backoff delay with jitter to prevent thundering herd on retry. */
const calculateBackoffDelay = (attempt: number): number => {
  const baseDelayMs = Math.pow(2, attempt - 1) * 1000;
  const jitterFactor = 0.5 + Math.random();
  return Math.floor(baseDelayMs * jitterFactor);
};

/** Log retry failure to Sentry and console with appropriate severity based on attempt number. */
const logRetryFailure = (error: Error, attempt: number, maxAttempts: number, isFinal: boolean): void => {
  if (isFinal) {
    Sentry.captureException(error, {
      tags: { operation: 'persist-retry', final: true, maxAttempts },
      level: 'error',
      contexts: { retry: { finalAttempt: maxAttempts, exhausted: true } }
    });
    console.error('[analyses/persist] All retry attempts exhausted', {
      maxAttempts,
      error: error.message
    });
  } else {
    Sentry.captureException(error, {
      tags: { operation: 'persist-retry', attempt, maxAttempts },
      level: 'info',
      contexts: { retry: { attempt, maxAttempts } }
    });
    console.warn('[analyses/persist] Retry attempt failed, will retry', {
      attempt,
      maxAttempts,
      error: error.message
    });
  }
};

/** Coerce an unknown thrown value into an Error instance. Ensures consistent error handling. */
const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

/** Sleep for the jittered backoff delay corresponding to the given attempt. Jitter prevents thundering herd. */
const backoffDelay = (attempt: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, calculateBackoffDelay(attempt)));

/**
 * Retry async operation with exponential backoff and jitter.
 * Logs failures to Sentry and console; throws final error if all attempts exhausted.
 * @template T - Return type of the async function
 * @param fn - Async function to retry
 * @param maxAttempts - Maximum number of retry attempts (default: 2)
 * @returns Result of successful function invocation or throws final error
 */
const retryWithBackoff = async <T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> => {
  let lastError = new Error('Retry failed');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = toError(error);
      const isFinalAttempt = attempt === maxAttempts;
      logRetryFailure(lastError, attempt, maxAttempts, isFinalAttempt);
      if (!isFinalAttempt) await backoffDelay(attempt);
    }
  }
  throw lastError;
};

/**
 * Build sanitized validation report filename from title, channel, and timestamp.
 * Produces URL-safe filename like "video-title-channel-2026-07-11_14-30-45.md".
 * @param title - Video or analysis title to include in filename
 * @param channelTitle - Optional creator/channel name
 * @returns Sanitized markdown filename with timestamp
 */
/**
 * Build the channelMeta/comments slice of a validation_report PATCH.
 *
 * RCA (2026-08-02): `update_analysis_result_atomic` merges this patch onto
 * the DB row via `coalesce(...) || patch` -- any key PRESENT in the patch
 * overwrites the column's current value, even if that value is fresher
 * (written by a concurrent request) than what this request has. Spreading
 * `...priorReport` and then falling back to `priorReport.channelMeta` when
 * this request has no fresh value re-includes a stale, point-in-time-SELECT
 * snapshot as if it were current -- clobbering a concurrent writer's real
 * update. The fix is to OMIT the key entirely when this request has no
 * fresh value, so the atomic merge leaves whatever is already in the column
 * untouched.
 */
function withFreshAuxMetadata(
  channelMeta: unknown,
  comments: unknown
): { channelMeta?: unknown; comments?: unknown } {
  const patch: { channelMeta?: unknown; comments?: unknown } = {};
  if (channelMeta != null) patch.channelMeta = channelMeta;
  if (comments != null) patch.comments = comments;
  return patch;
}

function buildValidationFilename(title: string, channelTitle?: string | null): string {
  /**
   * Convert text to URL-safe slug by removing special characters.
   * Replaces non-alphanumeric with hyphens, collapses multiple hyphens, strips leading/trailing.
   */
  const cleanSlug = (text: string): string => {
    return text
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      || 'unknown';
  };

  /** Format current timestamp as YYYY-MM-DD_HH-MM-SS string for consistent file ordering. */
  const getFormattedTimestamp = (): string => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
  };

  const titleSlug = cleanSlug(title || 'analysis');
  const creatorSlug = cleanSlug(channelTitle || 'creator');
  const timestamp = getFormattedTimestamp();
  return `${titleSlug}-${creatorSlug}-${timestamp}.md`;
}

/**
 * Server-to-server persistence endpoint. The Cloudflare Worker calls this (from
 * ctx.waitUntil, after the stream completes or is interrupted) with the generated
 * markdown and an HMAC content signature.
 *
 * ADR 006: Dual-write persistence
 * - analysis_markdown: Reconstructed markdown for backward compat + PDF export
 * - analysis_payload: Structured JSON (v2.0 schema) for KG visualization + cache hits
 */
export async function POST(request: NextRequest) {
  let body: any;

  try {
    body = await request.json();
    
    const bodySchema = z.object({
      analysisId: z.string().uuid(),
      videoId: z.string().min(1),
      markdown: z.string(),
      payload: z.unknown().optional(),
      model: z.string().optional(),
      valid: z.boolean().optional(),
      contentSig: z.string(),
      // Expiry for the bound content signature (see verifyContentSig). Optional
      // for backward compat with a worker that hasn't shipped the bound signer yet.
      exp: z.number().int().optional(),
      status: z.enum(['completed', 'failed', 'interrupted']).optional().default('completed'),
      // ADR 020 Phase 2: explicit "the user clicked stop" signal from the
      // worker (analysis.ts's cancelController). Overrides the normal
      // content-based billing_status computation below -- a user can cancel
      // AFTER most dimensions already streamed, which would otherwise look
      // "valid" by content alone and get silently marked 'completed'.
      cancelled: z.boolean().optional().default(false),
      // ADR 020 Phase 3: real OpenRouter usage/cost for the cost ledger.
      // Unsigned (not part of `canonical` below) -- purely accounting
      // telemetry, unlike `cancelled` which decides billing_status and is
      // therefore integrity-sensitive.
      tokensUsed: z.number().int().min(0).optional(),
      costUsd: z.number().min(0).optional(),
      // Exact traceability (2026-08-02): OpenRouter's own generation id for
      // this chunk's call. MUST stay in the signed canonical below in
      // lockstep with PersistService.ts's signer (same hazard as
      // tokensUsed/costUsd -- see canonical construction below).
      generationId: z.string().optional(),
      chunkIndex: z.number().int().min(1).max(TOTAL_STREAMS).optional(),
      totalChunks: z.number().int().refine((val) => val === TOTAL_STREAMS, {
        message: `totalChunks must match active configuration matrix of ${TOTAL_STREAMS}`,
      }).optional(),
      segments: z.array(z.object({
        start: z.number(),
        duration: z.number(),
        text: z.string(),
      })).optional(),
      // Flat transcript text carried alongside segments so a `transcripts` row
      // can still be written when the video's transcript arrived pre-fetched
      // (no timing) via initial ingestion rather than the worker's own fetch.
      transcript: z.string().optional(),
      // Channel-level metadata (subscriber count, channel description, etc.)
      // from the worker's TranscriptExtractor.fetchChannelMetadata.
      channelMeta: z.record(z.string(), z.unknown()).nullable().optional(),
      // Top relevance-ordered video comments from the worker's
      // MetadataScraper.fetchComments (YouTube Data API commentThreads.list).
      comments: z.array(z.object({
        author: z.string(),
        text: z.string(),
        publishedAt: z.string(),
        likeCount: z.number(),
      })).nullable().optional(),
      // Chapter markers parsed from the video description by the worker's
      // chapter-parser.ts (0:00 Intro-style lines). Upserted into
      // `transcript_chapters` on (video_id, idx). Null/absent when the
      // description has no chapter markers (most videos) — no rows written.
      // Constrained per PR #205 review (2026-08-05): chapter persistence is
      // best-effort (failures are caught/logged, don't fail the request), so
      // malformed input could otherwise silently corrupt chapter state with
      // no visible failure. The end_seconds > start_seconds cross-field
      // check can't be expressed as a plain Zod constraint without
      // .refine() -- deliberately done as a manual post-parse filter
      // instead (see filterValidChapters() below), not a Zod .refine(),
      // because qa-intel's SchemaContractRule only recognizes .optional()
      // chained directly after .refine() in the same fluent expression; a
      // .refine() nested inside z.array(...).nullable().optional() is
      // structurally invisible to that check even though it's empirically
      // safe (verified: omitting the field / null / [] all parse fine,
      // only a malformed element would be rejected) -- restructuring around
      // the rule's blind spot rather than fighting a false positive.
      // Mirrors the DB CHECK constraint in
      // supabase/migrations/20260805003000_transcript_chapters_check_constraint.sql.
      chapters: z.array(z.object({
        idx: z.number().int().min(0),
        start_seconds: z.number().finite().min(0),
        end_seconds: z.number().finite().min(0),
        label: z.string().trim().min(1),
      })).nullable().optional(),
    });

    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json({ 
        error: 'Invalid request payload schema', 
        details: parsedBody.error.flatten() 
      }, { status: 400 });
    }

    const conductor = new WorkflowConductor();
    const roomResult = await conductor.routeToRoom('persist', async () => {
      const {
        analysisId,
        videoId,
        markdown,
        payload,
        model,
        valid,
        contentSig,
        exp,
        status,
        cancelled,
        tokensUsed,
        costUsd,
        generationId,
        chunkIndex,
        totalChunks,
        segments,
        transcript,
        channelMeta: rawChannelMeta,
        comments: rawComments,
        chapters: rawChaptersInput,
      } = parsedBody.data;

      // Cross-field check (end_seconds > start_seconds) that Zod's
      // per-field constraints can't express -- see the schema comment above
      // for why this is a manual filter rather than z.refine(). Malformed
      // elements are dropped rather than failing the whole request, matching
      // this route's existing best-effort posture for chapters (a bad
      // element from one chunk shouldn't block persisting the rest, or the
      // analysis itself).
      const rawChaptersFiltered = rawChaptersInput?.filter((c) => {
        const ok = c.end_seconds > c.start_seconds;
        if (!ok) {
          console.warn('[analyses/persist] Dropped malformed chapter (end_seconds <= start_seconds)', { analysisId, idx: c.idx });
        }
        return ok;
      });
      // Distinguish "worker genuinely parsed zero chapters" (rawChaptersInput
      // null/undefined/[]) from "every submitted chapter was malformed"
      // (rawChaptersInput had elements, all got filtered out above). Cubic
      // review, 2026-08-05: the two were previously indistinguishable, so an
      // all-malformed submission fell through to the same attemptedButEmpty
      // sentinel path as a real empty parse -- which DELETES existing real
      // chapter rows for the video (see upsertChapters). A malformed
      // submission must not be able to wipe out previously-valid chapters;
      // skip persistence entirely instead.
      const allChaptersMalformed = !!rawChaptersInput && rawChaptersInput.length > 0 && (rawChaptersFiltered?.length ?? 0) === 0;
      if (allChaptersMalformed) {
        Sentry.captureMessage('analyses/persist: all submitted chapters malformed, skipping persistence', {
          level: 'warning',
          tags: { operation: 'chapters-persist' },
          extra: { analysisId, submittedCount: rawChaptersInput!.length },
        });
        console.error('[analyses/persist] All submitted chapters were malformed -- skipping chapter persistence entirely, not treating as an empty parse', { analysisId, submittedCount: rawChaptersInput!.length });
      }
      const rawChapters = allChaptersMalformed ? undefined : (rawChaptersFiltered ?? rawChaptersInput);

      // Defense in depth: the worker already caps channelMeta (see
      // MAX_CHANNEL_META_BYTES in worker/src/routes/analysis.ts), but this is a
      // network boundary from a separate deployable -- don't trust that
      // invariant holds. Drop rather than reject the whole persist: this field
      // is best-effort enrichment, not something worth failing an analysis over.
      const channelMeta = rawChannelMeta && JSON.stringify(rawChannelMeta).length <= 20_000 ? rawChannelMeta : null;
      if (rawChannelMeta && !channelMeta) {
        console.warn('[analyses/persist] channelMeta exceeded size limit, dropping', { analysisId });
      }

      // Iteratively slice comments array so large payloads are bounded under 20KB without being completely dropped
      let comments = rawComments ?? null;
      if (comments && Array.isArray(comments)) {
        let bounded = comments;
        while (bounded.length > 0 && JSON.stringify(bounded).length > 20_000) {
          bounded = bounded.slice(0, -1);
        }
        comments = bounded.length > 0 ? bounded : null;
        if (rawComments && bounded.length < rawComments.length) {
          console.warn('[analyses/persist] comments capped to fit 20KB budget', { analysisId, original: rawComments.length, kept: bounded.length });
        }
      }

      const resolvedTotal = totalChunks ?? TOTAL_STREAMS;

      // cancelled/tokensUsed/costUsd included here (ADR 020 Phase 2/3
      // security fix) -- must stay in lockstep with PersistService.ts's
      // signer, field-for-field including the ?? null coercions (any
      // mismatch, e.g. ?? undefined here vs ?? null there, changes the
      // JSON.stringify output and every legitimate signature would fail
      // verification). cancelled decides billing_status below; tokensUsed/
      // costUsd feed the admin cost ledger -- all three need the same
      // integrity guarantee as markdown/payload (cubic review, PR #175).
      const canonical = JSON.stringify({
        markdown,
        payload: payload ?? null,
        cancelled,
        tokensUsed: tokensUsed ?? null,
        costUsd: costUsd ?? null,
        generationId: generationId ?? null,
      });
      let isSigValid = false;
      try {
        isSigValid = await verifyContentSig(canonical, contentSig, exp !== undefined ? { purpose: 'persist', id: analysisId, exp } : undefined);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        Sentry.captureException(error, { contexts: { persist: { phase: 'verifyContentSig', analysisId, videoId } } });
        console.error('[analyses/persist]', { message: msg, analysisId, videoId });
        return { type: 'error' as const, error: 'Security configuration error', status: 500 };
      }

      if (!isSigValid) {
        console.warn('[analyses/persist] Invalid content signature', { analysisId, videoId });
        return { type: 'error' as const, error: 'Invalid signature', status: 401 };
      }

      let validPayload: UCISPayloadV2 | undefined;

      if (payload !== undefined && payload !== null) {
        const isChunk = chunkIndex !== undefined;
        const parseResult = isChunk
          ? z.object({
              schemaVersion: z.literal('2.0'),
              dimensions: z.array(z.object({
                number: z.number().int().min(0).max(TOTAL_DIMENSIONS),
                name: z.string(),
                content: z.string()
              }))
            }).passthrough().safeParse(payload)
          : UCISPayloadV2Schema.safeParse(payload);

        if (!parseResult.success) {
          console.warn('[analyses/persist] Invalid payload schema', { 
            analysisId, 
            videoId, 
            chunkIndex,
            errors: parseResult.error.flatten() 
          });
          return { type: 'error' as const, error: 'Invalid payload schema', status: 400 };
        }
        validPayload = parseResult.data as any;
      }

      const persistenceAdapter = new SupabasePersistenceAdapter();
      const billingQuotaPort = new PostgresBillingAdapter();
      const row = await retryWithBackoff(
        () => persistenceAdapter.findAnalysisForPersist({ analysisId, videoId }),
        2
      );

      if (!row) {
        Sentry.captureMessage('analysis-persist: row not found', {
          level: 'warning',
          tags: { operation: 'analysis-persist', reason: 'row-not-found' },
          extra: { analysisId, videoId, status },
        });
        console.warn('[analyses/persist] Row not found (env mismatch?)', { analysisId, videoId });
        return { type: 'error' as const, error: 'Analysis not found', status: 404 };
      }

      const priorReport: PersistedValidationReport = isPersistedValidationReport(row.validationReport)
        ? row.validationReport
        : { status: 'processing' };
      const priorPayload = (row.analysisPayload as Record<string, any>) || {};
      const isInterrupted = status === 'interrupted';

      if (chunkIndex !== undefined && validPayload && 'dimensions' in validPayload) {
        // Process this specific chunk; return early if chunk is complete or timeout detected.
        const dimensionsCovered = Array.isArray(validPayload.dimensions)
          ? (validPayload.dimensions as any[]).map((d: any) => d.number)
          : [];

        // Diagnostic logging for empty or sparse dimensions
        const dimensionDetails = (validPayload.dimensions as any[]).map(d => ({
          number: d.number,
          hasContent: typeof d.content === 'string' && d.content.trim().length > 0,
          contentLength: typeof d.content === 'string' ? d.content.length : 0
        }));

        if (dimensionsCovered.length === 0) {
          console.warn('[analyses/persist] Chunk arrived with empty dimensions array', {
            analysisId,
            videoId,
            chunkIndex,
            status
          });
        } else if (dimensionDetails.some(d => !d.hasContent)) {
          console.warn('[analyses/persist] Chunk has dimensions with empty content', {
            analysisId,
            videoId,
            chunkIndex,
            status,
            dimensionDetails
          });
        }

        await retryWithBackoff(
          () => persistenceAdapter.persistAnalysisChunk({
            analysisId,
            chunkIndex,
            dimensionsCovered,
            payload,
            status,
            tokensUsed,
            costUsd,
            generationId,
          }),
          2
        );

        // SAFETY-NET WRITE, not the authoritative one — re-audit finding P1.2.
        // This upsert stores whatever segments THIS chunk carries, so a transcript
        // row exists even if the analysis is interrupted/times out before the
        // finalize-path call below ever runs. It intentionally re-fires per chunk;
        // each call's content reflects only that chunk, so intermediate rows are
        // partial by design. If finalize-path DOES run afterward for this video_id,
        // its call happens later in the same request lifecycle and its full-content
        // upsert is the one that should be trusted — upsertTranscript's own
        // check-then-upsert (see SupabaseTranscriptAdapter.ts) makes repeat calls for
        // the same video_id safe (no duplicate rows, no retention-timestamp reset on
        // update), and SupabaseTranscriptAdapter.test.ts asserts the last call's
        // content is what's actually persisted. Do not remove this call to "avoid
        // duplication" — partial/interrupted analyses would silently stop getting a
        // transcript row at all, regressing the original P3 fix this exists for.
        const hasSegments = segments && segments.length > 0;
        const hasFlatTranscript = !!transcript && transcript.trim().length > 0 && !transcript.includes('Transcript unavailable') && !transcript.includes('No captions available');
        if (hasSegments || hasFlatTranscript) {
          const segmentsText = hasSegments ? segments!.map((s: any) => s.text || '').join(' ').trim() : '';
          await SupabaseTranscriptAdapter.upsertTranscript({
            videoId,
            content: segmentsText || transcript || markdown,
            segments: segments || [],
            language: 'en',
            hash: row.transcriptHash || undefined,
          }).catch(e => {
            Sentry.captureException(e, { contexts: { persist: { phase: 'upsert_transcript_chunk', analysisId } } });
            console.warn('[analyses/persist] Failed to upsert transcript segments in chunk path', { analysisId, error: String(e) });
          });
        }

        // Same safety-net pattern as the transcript write above (P0-1 placement
        // fix, PR #205 review 2026-08-05): chapters are chunk-independent data
        // -- the worker parses the same description-derived chapters on every
        // chunk request, not just the finalizing one -- so gating this write
        // behind isFullyReceived (its original P0-1 placement) meant a
        // partial/interrupted analysis that never receives all chunks lost
        // chapter data that was actually available on an earlier successful
        // chunk. upsertChapters is idempotent on (video_id, idx), so firing on
        // every chunk is harmless; moved here to run unconditionally per chunk
        // instead of only inside the isFullyReceived finalization branch below.
        if (rawChapters) {
          await SupabaseTranscriptAdapter.upsertChapters(
            videoId,
            rawChapters.map((c) => ({
              video_id: videoId,
              idx: c.idx,
              start_seconds: c.start_seconds,
              end_seconds: c.end_seconds,
              label: c.label,
            })),
            { attemptedButEmpty: rawChapters.length === 0 }
          ).catch(e => {
            Sentry.captureException(e, { contexts: { persist: { phase: 'upsert_chapters_chunked', analysisId } } });
            console.warn('[analyses/persist] Failed to upsert chapters (chunked path)', { analysisId, error: String(e) });
          });
        }

        // Verify chunk completeness immediately after persisting chunk
        const chunks = await retryWithBackoff(
          () => persistenceAdapter.findAnalysisChunks({ analysisId }),
          2
        );
        const FINAL_CHUNK_STATUS = 'completed';
        const finalChunks = chunks ? chunks.filter(c => c.status === FINAL_CHUNK_STATUS) : [];

        const receivedIndexSet = new Set(finalChunks.map(c => c.chunk_index));
        let isFullyReceived = true;
        const unreceived: number[] = [];
        for (let i = 1; i <= resolvedTotal; i++) {
          if (!receivedIndexSet.has(i)) {
            isFullyReceived = false;
            unreceived.push(i);
          }
        }

        // Check if we've exceeded the timeout window while waiting for chunks
        let exceedsTimeout = false;
        if (!isFullyReceived && finalChunks.length > 0) {
          const minimumChunkThreshold = Math.ceil(resolvedTotal * 0.6);
          if (finalChunks.length >= minimumChunkThreshold) {
            const currentTime = Date.now();
            const chunkTimes = finalChunks
              .map(c => c.updated_at)
              .filter((t): t is string => t !== null)
              .map(t => new Date(t).getTime())
              .filter(Number.isFinite);
            const latestChunkTime = chunkTimes.length > 0 ? Math.max(...chunkTimes) : null;
            const elapsedMs = latestChunkTime === null ? 0 : currentTime - latestChunkTime;

            if (latestChunkTime !== null && elapsedMs >= 30000) {
              exceedsTimeout = true;
              if (unreceived.length > 0) {
                console.error('[analyses/persist] Chunk reception timeout after waiting 30s: chunks missing', {
                  analysisId,
                  videoId,
                  receivedCount: finalChunks.length,
                  expectedTotal: resolvedTotal,
                  unreceived,
                  elapsedMs
                });
              }
            }
          }
        }

        // If timeout detected AND chunks are missing, mark as partial before proceeding
        if (exceedsTimeout && unreceived.length > 0) {
          const incompletionReport: PersistedValidationReport = {
            ...priorReport,
            status: 'partial',
            model_used: model || null,
            valid: false,
          };

          await retryWithBackoff(
            () => persistenceAdapter.updateAnalysisResult({
              analysisId,
              markdown,
              payload: validPayload ?? null,
              model: model || null,
              validationPassed: false,
              validationReport: incompletionReport,
            }),
            2
          );

          return { type: 'partial_timeout' as const, analysisId, missingChunks: unreceived };
        }

        if (isFullyReceived) {
          const chunkMap = new Map<number, any>();
          finalChunks.forEach(c => {
            chunkMap.set(c.chunk_index, c.payload);
          });

          // CONTRACT VALIDATION: Verify all chunks have required payload structure
          // Each chunk MUST have a dimensions field (can be empty array, but field must exist)
          // This ensures consistent payload structure across all 5 streams
          const invalidChunks = [];
          for (let i = 1; i <= resolvedTotal; i++) {
            const chunkPayload = chunkMap.get(i);
            // Fail if: chunk missing entirely OR dimensions field missing/not-array
            // (empty dimensions arrays ARE acceptable — stream may generate no content for its slice)
            if (!chunkPayload || !('dimensions' in chunkPayload) || !Array.isArray(chunkPayload.dimensions)) {
              invalidChunks.push(i);
            }
          }

          // If any chunks missing or malformed, fail loudly
          if (invalidChunks.length > 0) {
            console.error('[analyses/persist] CONTRACT VIOLATION: Chunks missing or have invalid dimensions field', {
              analysisId,
              videoId,
              invalidChunks,
              totalExpected: resolvedTotal,
              totalReceived: finalChunks.length,
              receivedIndices: Array.from(chunkMap.keys()).sort()
            });
            // Preserve existing valid completed results; only fail incomplete analyses
            const isAlreadyValid = priorReport.status === 'done' && priorReport.valid === true;
            if (!isAlreadyValid) {
              const failureReport: PersistedValidationReport = {
                ...priorReport,
                status: 'failed',
                model_used: model || null,
                valid: false,
              };
              await retryWithBackoff(
                () => persistenceAdapter.updateAnalysisResult({
                  analysisId,
                  markdown: '',
                  payload: null,
                  model: model || null,
                  validationPassed: false,
                  validationReport: failureReport,
                }),
                2
              );
            }
            const errorMsg = `Chunk assembly failed: ${invalidChunks.length} chunks missing`;
            return { type: 'error' as const, error: errorMsg, status: 400 };
          }

          // CRITICAL SAFETY CHECK: Verify all expected chunks are present before stitching
          if (finalChunks.length !== resolvedTotal) {
            console.error('[analyses/persist] Safety halt: incomplete chunk set detected before stitching', {
              analysisId,
              persisted: finalChunks.length,
              expected: resolvedTotal,
              unreceived
            });
            const safetyReport: PersistedValidationReport = {
              ...priorReport,
              status: 'partial',
              model_used: model || null,
              valid: false,
            };
            await retryWithBackoff(
              () => persistenceAdapter.updateAnalysisResult({
                analysisId,
                markdown,
                payload: validPayload ?? null,
                model: model || null,
                validationPassed: false,
                validationReport: safetyReport,
              }),
              2
            );
            return { type: 'partial_timeout' as const, analysisId, missingChunks: unreceived };
          }

          const extraMetadata = {
            videoMetadata: priorPayload?.videoMetadata ?? (priorReport as any)?.metadata ?? null,
            channelMeta: channelMeta ?? priorPayload?.channelMeta ?? (priorReport as any)?.channelMeta ?? null,
            comments: comments ?? priorPayload?.comments ?? (priorReport as any)?.comments ?? null,
          };
          const stitchResult = stitchChunksIntoPayload(chunkMap, resolvedTotal, extraMetadata);
          const stitchedPayload = stitchResult.payload ?? null;
          const stitchedMarkdown = stitchResult.markdown;
          const isStitchedValid = stitchResult.validationPassed;

          const { dimensionStatus, validationStatus: computedValidationStatus, billingStatus } = buildDimensionStatus(stitchedPayload);
          const finalStatus = isStitchedValid ? computedValidationStatus : 'partial';
          const { channelMeta: _priorChannelMeta, comments: _priorComments, ...priorReportSansAux } = priorReport as any;
          const newReport: PersistedValidationReport = {
            ...priorReportSansAux,
            validation_status: finalStatus,
            status: finalStatus,
            billing_status: resolveBillingStatus(cancelled, billingStatus),
            dimension_status: dimensionStatus,
            model_used: model || null,
            valid: isStitchedValid && finalStatus === 'done',
            ...withFreshAuxMetadata(channelMeta, comments),
          };

          await retryWithBackoff(
            () => persistenceAdapter.updateAnalysisResult({
              analysisId,
              markdown: stitchedMarkdown,
              payload: stitchedPayload ?? null,
              model: model || null,
              validationPassed: isStitchedValid,
              validationReport: newReport,
            }),
            2
          );

          // Cache any billing-complete result (ADR Law #1: prevent paid re-analysis on re-request).
          // Gate on billingStatus === 'completed' (dimension completeness), NOT isStitchedValid
          // (KG/persona schema quality). After the 2026-08-03 billing fix, isStitchedValid=false
          // + billingStatus='completed' is reachable for real billed rows where schema validation
          // failed on cosmetic KG/persona metadata but all dimensions are present. Gating on
          // isStitchedValid here would silently skip caching those rows, violating ADR Law #1.
          if (billingStatus === 'completed') {
            const cachedPayload: CachedAnalysisResult = {
              id: analysisId,
              video_id: videoId,
              title: row.title,
              analysis_markdown: stitchedMarkdown,
              analysis_payload: stitchedPayload as any,
              validation_report: {
                transcript_available: !!priorReport.transcript_available,
                analysis_type: (priorReport.analysis_type as 'full' | 'metadata-only') || 'full',
              },
              model_used: model || 'edge-stream',
              created_at: row.createdAt,
              cached_at: new Date().toISOString(),
            };
            // ADR 006: Cache key based on input (transcript) hash, not output (markdown) hash
            // Ensures cache hit detection on identical inputs despite markdown formatting changes
            const hash = row.transcriptHash || (() => {
              console.warn('[analyses/persist] Missing transcriptHash; computing from transcript', { analysisId, videoId });
              return createHash('sha256').update(row.transcript || '').digest('hex');
            })();
            const cacheKey = generateCacheKey('edge-stream', hash, '5.1');
            await setAnalysisCache(cacheKey, cachedPayload).catch(e => {
              Sentry.captureException(e, { contexts: { persist: { phase: 'cache_stitched_result', analysisId } } });
              console.warn('[analyses/persist] Failed to cache stitched result', { analysisId, error: String(e) });
            });

            if (!!priorReport.transcript_available) {
              await publishValidationTask({
                videoId,
                markdown: stitchedMarkdown,
                filename: buildValidationFilename(row.title, row.channelTitle),
                userId: row.userId,
                analysisId,
                metadata: { title: row.title, channelTitle: row.channelTitle || '' },
              }).catch(e => {
                Sentry.captureException(e, { contexts: { persist: { phase: 'publish_validation_task_chunks', analysisId } } });
                console.warn('[analyses/persist] Failed to publish validation task for chunks', { analysisId, error: String(e) });
              });
            }

            // 10X re-audit NEW-H(dim0-trigger): give every finalized analysis a
            // server-side digest attempt regardless of whether the client ever
            // mounts the Executive Summary panel. Idempotent + best-effort --
            // failure here must never affect the persist response.
            await publishDigestTask({ analysisId, userId: row.userId }).catch(e => {
              Sentry.captureException(e, { contexts: { persist: { phase: 'publish_digest_task_chunks', analysisId } } });
              console.warn('[analyses/persist] Failed to publish digest task for chunks', { analysisId, error: String(e) });
            });

            // Usage-log: analysis genuinely completed (chunked path). Purely
            // additive, fire-and-forget -- consumeQuota() itself never
            // throws (see PostgresBillingAdapter), and this .catch() is a
            // second belt-and-braces guard so a failure here can never
            // affect the persist response. Note: a retried/re-persisted
            // request for the same analysisId could in theory reach this
            // gate more than once -- harmless for a pure usage-log row (not
            // a decrementing counter), so no idempotency guard is added.
            // ADR 020 Phase 3: sum real per-chunk OpenRouter usage/cost --
            // each of the (up to 5) chunks is its own independent LLM call
            // with its own tokensUsed/costUsd, so the analysis's true total
            // cost is the sum across all of them, not just this final chunk.
            const totalTokensUsed = finalChunks.reduce((sum, c) => sum + (c.tokens_used ?? 0), 0);
            const totalCostUsd = finalChunks.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0);

            getUserTier(row.userId)
              .then((tier) => billingQuotaPort.consumeQuota({ userId: row.userId, tier, analysisId, tokensUsed: totalTokensUsed, costUsd: totalCostUsd }))
              .catch(e => {
                console.warn('[analyses/persist] Failed to log analysis_completed usage event (chunked path)', { analysisId, error: String(e) });
              });
          }
        }

        return { type: 'chunk_saved' as const, analysisId, chunkIndex };
      }

      // For chunked requests, verify all chunks have been persisted before deciding final status
      let finalStatus: ValidationReportStatus;
      let validationPassed: boolean;
      let finalMissingChunks: number[] = [];
      const expectsChunkSet = totalChunks !== undefined;

      let finalizedChunks: any[] = [];
      let allReceived: boolean;

      if (isInterrupted) {
        finalStatus = 'interrupted';
        validationPassed = false;
      } else if (expectsChunkSet) {
        // Explicitly verify chunk completeness BEFORE assigning final status
        const storedChunks = await retryWithBackoff(
          () => persistenceAdapter.findAnalysisChunks({ analysisId }),
          2
        );
        const FINAL_STATUS = 'completed';
        finalizedChunks = storedChunks ? storedChunks.filter(c => c.status === FINAL_STATUS) : [];
        const receivedIndices = new Set(finalizedChunks.map(c => c.chunk_index));

        allReceived = true;
        const missing: number[] = [];
        for (let i = 1; i <= resolvedTotal; i++) {
          if (!receivedIndices.has(i)) {
            allReceived = false;
            missing.push(i);
          }
        }

        // Only mark as 'done' if ALL chunks have been persisted,
        // OR if minimum threshold (60%) reached and has exceeded 30s timeout window
        if (!allReceived) {
          const minimumChunkThreshold = Math.ceil(resolvedTotal * 0.6);
          const hasMinimum = finalizedChunks.length >= minimumChunkThreshold;
          const currentTime = Date.now();
          const chunkTimes = finalizedChunks
            .map(c => c.updated_at)
            .filter((t): t is string => t !== null)
            .map(t => new Date(t).getTime())
            .filter(Number.isFinite);
          const latestChunkTime = chunkTimes.length > 0 ? Math.max(...chunkTimes) : null;
          const elapsedMs = latestChunkTime === null ? 0 : currentTime - latestChunkTime;

          if (hasMinimum && elapsedMs >= 30000) {
            // Timeout with minimum chunks: finalize as partial (not done) to reflect incomplete analysis
            console.warn('[analyses/persist] Finalizing with partial chunks after 30s timeout', {
              analysisId,
              videoId,
              persisted: finalizedChunks.length,
              expected: resolvedTotal,
              elapsedMs
            });
            finalStatus = 'partial';
            validationPassed = false;
            finalMissingChunks = missing;
          } else {
            finalStatus = 'partial';
            validationPassed = false;
            finalMissingChunks = missing;
            console.warn('[analyses/persist] Final check: incomplete chunk set prevents done status', {
              analysisId,
              videoId,
              missing,
              persisted: finalizedChunks.length,
              expected: resolvedTotal,
              hasMinimum,
              elapsedMs
            });
          }
        } else {
          finalStatus = 'done';
          validationPassed = Boolean(valid);
        }
      } else {
        // Non-chunk finalization: accept valid/invalid status directly
        validationPassed = Boolean(valid);
        finalStatus = validationPassed ? 'done' : 'failed';
      }

      // If status is partial and we have chunks, attempt to stitch what we have
      let stitchedPayload = validPayload;
      let stitchedMarkdown = markdown;
      if (finalStatus === 'partial' && finalizedChunks.length > 0) {
        try {
          const partialChunkMap = new Map<number, any>();
          finalizedChunks.forEach(c => {
            partialChunkMap.set(c.chunk_index, c.payload);
          });

          const extraMetadata = {
            videoMetadata: priorPayload?.videoMetadata ?? (priorReport as any)?.metadata ?? null,
            channelMeta: channelMeta ?? priorPayload?.channelMeta ?? (priorReport as any)?.channelMeta ?? null,
            comments: comments ?? priorPayload?.comments ?? (priorReport as any)?.comments ?? null,
          };
          const stitchResult = stitchChunksIntoPayload(partialChunkMap, resolvedTotal, extraMetadata);
          if (stitchResult.payload !== undefined) {
            stitchedPayload = stitchResult.payload;
            stitchedMarkdown = stitchResult.markdown;
            if (!stitchResult.validationPassed) {
              console.warn('[analyses/persist] Stitched partial payload used but schema validation failed', {
                analysisId,
                videoId,
                chunkCount: finalizedChunks.length
              });
            }
          } else {
            console.warn('[analyses/persist] Stitched partial payload failed validation or has no dimensions', {
              analysisId,
              videoId,
              chunkCount: finalizedChunks.length
            });
          }
        } catch (stitchErr) {
          const message = stitchErr instanceof Error ? stitchErr.message : String(stitchErr);
          Sentry.captureException(stitchErr, { contexts: { persist: { phase: 'stitch_partial_chunks', analysisId } } });
          console.error('[analyses/persist]', { message, phase: 'stitch_partial_chunks' });
          // Continue with original payload if stitching fails
        }
      }

      // Build dimension status for billing and validation decisions
      // Preserve chunk-derived finalStatus when payload is absent
      const payloadToEvaluate = stitchedPayload ?? validPayload;
      const { dimensionStatus, validationStatus: computedValidationStatus, billingStatus } = buildDimensionStatus(payloadToEvaluate);

      // Use computed validation status only if we have a payload to evaluate; otherwise preserve finalStatus
      const reportValidationStatus = payloadToEvaluate !== undefined && computedValidationStatus ? computedValidationStatus : finalStatus;

      const { channelMeta: _priorChannelMeta2, comments: _priorComments2, ...priorReportSansAux2 } = priorReport as any;
      const newReport: PersistedValidationReport = {
        ...priorReportSansAux2,
        validation_status: reportValidationStatus,
        status: reportValidationStatus, // Legacy field for backward compat
        // cancelled overrides content-based computation entirely -- the
        // user explicitly stopped this, regardless of how much content
        // happened to complete first (ADR 020 Phase 2).
        // payloadToEvaluate guard: if no payload exists, preserve the prior row's billing_status.
        billing_status: payloadToEvaluate !== undefined ? resolveBillingStatus(cancelled, billingStatus) : priorReport.billing_status,
        dimension_status: payloadToEvaluate !== undefined ? dimensionStatus : priorReport.dimension_status,
        model_used: model || null,
        valid: reportValidationStatus === 'done' && validationPassed,
        ...withFreshAuxMetadata(channelMeta, comments),
      };

      await retryWithBackoff(
        () => persistenceAdapter.updateAnalysisResult({
          analysisId,
          markdown: stitchedMarkdown,
          payload: stitchedPayload ?? null,
          model: model || null,
          validationPassed,
          validationReport: newReport,
        }),
        2
      );

      // AUTHORITATIVE WRITE — re-audit finding P1.2. When this runs, it's the
      // full stitched content across every chunk, and it runs after any
      // chunk-path upsert above for this same request/video_id, so it correctly
      // overwrites whatever partial content the safety-net write left behind.
      // See the comment at the chunk-path call site (~line 475) for the full
      // relationship — the two calls are deliberately not consolidated into one.
      const finalHasSegments = segments && segments.length > 0;
      const finalHasFlatTranscript = !!transcript && transcript.trim().length > 0 && !transcript.includes('Transcript unavailable') && !transcript.includes('No captions available');
      if ((finalHasSegments || finalHasFlatTranscript) && (finalStatus === 'done' || finalStatus === 'partial')) {
        await SupabaseTranscriptAdapter.upsertTranscript({
          videoId,
          content: transcript || stitchedMarkdown || markdown,
          segments: segments || [],
          language: 'en',
          hash: row.transcriptHash || undefined,
        }).catch(e => {
          Sentry.captureException(e, { contexts: { persist: { phase: 'upsert_transcript', analysisId } } });
          console.warn('[analyses/persist] Failed to upsert transcript segments', { analysisId, error: String(e) });
        });
      }

      // Chapters (Gap 2): persist the parsed chapter markers when the worker
      // sent any. Three-state: non-empty -> green rows; empty array (worker
      // parsed the description and found zero markers) -> attempted-but-empty
      // sentinel so the history chip renders orange; absent (worker never
      // parsed) -> no rows, chip renders grey.
      if (rawChapters) {
        await SupabaseTranscriptAdapter.upsertChapters(
          videoId,
          rawChapters.map((c) => ({
            video_id: videoId,
            idx: c.idx,
            start_seconds: c.start_seconds,
            end_seconds: c.end_seconds,
            label: c.label,
          })),
          { attemptedButEmpty: rawChapters.length === 0 }
        ).catch(e => {
          Sentry.captureException(e, { contexts: { persist: { phase: 'upsert_chapters', analysisId } } });
          console.warn('[analyses/persist] Failed to upsert chapters', { analysisId, error: String(e) });
        });
      }

      if (isInterrupted) {
        return { type: 'interrupted' as const, analysisId };
      }

      if (finalStatus === 'partial') {
        return { type: 'partial_timeout' as const, analysisId, missingChunks: finalMissingChunks };
      }

      const transcriptAvailable = !!priorReport.transcript_available;
      const cachedPayload: CachedAnalysisResult = {
        id: analysisId,
        video_id: videoId,
        title: row.title,
        analysis_markdown: stitchedMarkdown,
        analysis_payload: (stitchedPayload ?? null) as Record<string, unknown> | null,
        validation_report: {
          transcript_available: !!priorReport.transcript_available,
          analysis_type: (priorReport.analysis_type as 'full' | 'metadata-only') || 'full',
        },
        model_used: model || 'edge-stream',
        created_at: row.createdAt,
        cached_at: new Date().toISOString(),
      };
      // ADR 006: Use transcript hash (input) for cache key, never markdown (output)
      // Compute hash if not available from database
      const hash = row.transcriptHash || createHash('sha256')
        .update(row.transcript || '')
        .digest('hex');
      const cacheKey = generateCacheKey('edge-stream', hash, '5.1');

      console.log('[analyses/persist] Persisting analysis', {
        analysisId,
        videoId,
        modelUsed: model,
        validationPassed,
        finalStatus,
        hasMarkdown: !!stitchedMarkdown,
        hasPayload: !!stitchedPayload,
        hasDimensions: stitchedPayload && 'dimensions' in stitchedPayload ? (stitchedPayload.dimensions?.length ?? 0) : 0,
        hasKG: stitchedPayload?.knowledgeGraph ? (stitchedPayload.knowledgeGraph.nodes?.length ?? 0) + ' nodes' : 'none',
        cacheKey,
      });

      const isNonChunkValid = validationPassed && finalStatus === 'done';
      if (isNonChunkValid) {
        await setAnalysisCache(cacheKey, cachedPayload).catch(e => {
          Sentry.captureException(e, { contexts: { persist: { phase: 'cache_final_result', analysisId } } });
          console.warn('[analyses/persist] Failed to cache final result', { analysisId, error: String(e) });
        });
      }

      if (transcriptAvailable && validationPassed) {
        await publishValidationTask({
          videoId,
          markdown: stitchedMarkdown,
          filename: buildValidationFilename(row.title, row.channelTitle),
          userId: row.userId,
          analysisId,
          metadata: { title: row.title, channelTitle: row.channelTitle || '' },
        }).catch(e => {
          Sentry.captureException(e, { contexts: { persist: { phase: 'publish_validation_task', analysisId } } });
          console.warn('[analyses/persist] Failed to publish validation task', { analysisId, error: String(e) });
        });
      }

      if (isNonChunkValid) {
        // 10X re-audit NEW-H(dim0-trigger): see the identical comment at the
        // chunk-path call site above.
        await publishDigestTask({ analysisId, userId: row.userId }).catch(e => {
          Sentry.captureException(e, { contexts: { persist: { phase: 'publish_digest_task', analysisId } } });
          console.warn('[analyses/persist] Failed to publish digest task', { analysisId, error: String(e) });
        });

        // Usage-log: analysis genuinely completed (non-chunked path). Same
        // fire-and-forget / cannot-fail-the-caller shape as the chunked-path
        // call site above -- see the comment there for the retry-safety
        // and non-blocking reasoning.
        getUserTier(row.userId)
          .then((tier) => billingQuotaPort.consumeQuota({ userId: row.userId, tier, analysisId, tokensUsed, costUsd }))
          .catch(e => {
            console.warn('[analyses/persist] Failed to log analysis_completed usage event', { analysisId, error: String(e) });
          });
      }

      return { type: 'ok' as const, analysisId };
    });

    if (!roomResult.success) {
      return NextResponse.json({ error: roomResult.error }, { status: roomResult.status });
    }

    const data = roomResult.data;
    switch (data.type) {
      case 'error':
        return NextResponse.json({ error: data.error }, { status: data.status });
      case 'chunk_saved':
        return NextResponse.json({ ok: true, analysisId: data.analysisId, chunkIndex: data.chunkIndex, status: 'chunk_saved' });
      case 'partial_timeout':
        return NextResponse.json({ ok: true, analysisId: data.analysisId, status: 'partial', missingChunks: data.missingChunks });
      case 'interrupted':
        return NextResponse.json({ ok: true, analysisId: data.analysisId, status: 'interrupted' });
      case 'ok':
        return NextResponse.json({ ok: true, analysisId: data.analysisId });
      default:
        break;
    }
    return NextResponse.json({ error: 'Unknown result type' }, { status: 500 });
  } catch (error) {
    const err = categorizeError(error, ERROR_PHASES.DATABASE_WRITE);
    Sentry.captureException(error, {
      tags: { operation: 'analysis-persist', phase: err.phase, retryable: String(err.retryable) },
      contexts: { api: { endpoint: '/api/analyses/persist', category: err.category, code: err.code } }
    });
    console.error('[analyses/persist] Failed:', { message: err.message, retryable: err.retryable });
    return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
  }
}