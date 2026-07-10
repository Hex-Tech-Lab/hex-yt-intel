export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { verifyContentSig } from '@/lib/stream-token';
import { UCISPayloadV2Schema } from '@/lib/validators/synthesis';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';
import { setAnalysisCache, generateCacheKey, type CachedAnalysisResult } from '@/lib/services/cache';
import { publishValidationTask } from '@/lib/qstash-client';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import * as Sentry from '@sentry/nextjs';
import { PersistedValidationReport, isPersistedValidationReport } from '@/lib/types/validation-report';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';
import { z } from 'zod';
import { TOTAL_DIMENSIONS, TOTAL_STREAMS } from '@/lib/config/synthesis';
import { WorkflowConductor } from '@/lib/services/WorkflowConductor';

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

/** Coerce an unknown thrown value into an Error instance. */
const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

/** Sleep for the jittered backoff delay corresponding to the given attempt. */
const backoffDelay = (attempt: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, calculateBackoffDelay(attempt)));

/** Retry async operation with exponential backoff and jitter; logs to Sentry on failure. */
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

/** Build sanitized validation report filename from title, channel, and timestamp. */
function buildValidationFilename(title: string, channelTitle?: string | null): string {
  /** Convert text to URL-safe slug by removing special characters. */
  const cleanSlug = (text: string): string => {
    return text
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      || 'unknown';
  };
  /** Format current timestamp as YYYY-MM-DD_HH-MM-SS string. */
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
      chunkIndex: z.number().int().min(1).max(TOTAL_STREAMS).optional(),
      totalChunks: z.number().int().refine((val) => val === TOTAL_STREAMS, {
        message: `totalChunks must match active configuration matrix of ${TOTAL_STREAMS}`,
      }).optional(),
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
        chunkIndex,
        totalChunks
      } = parsedBody.data;

      const resolvedTotal = totalChunks ?? TOTAL_STREAMS;

      const canonical = JSON.stringify({ markdown, payload: payload ?? null });
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
                number: z.number().int().min(1).max(TOTAL_DIMENSIONS),
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
      const isInterrupted = status === 'interrupted';

      if (chunkIndex !== undefined && validPayload && 'dimensions' in validPayload) {
        // Process this specific chunk; return early if chunk is complete or timeout detected.
        const dimensionsCovered = Array.isArray(validPayload.dimensions)
          ? (validPayload.dimensions as any[]).map((d: any) => d.number)
          : [];

        await retryWithBackoff(
          () => persistenceAdapter.persistAnalysisChunk({
            analysisId,
            chunkIndex,
            dimensionsCovered,
            payload,
            status,
          }),
          2
        );

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

          // CONTRACT VALIDATION: Verify all chunks have required payload structure with non-empty dimensions
          const missingChunks = [];
          const incompleteDimensions: { chunk: number; count: number }[] = [];
          for (let i = 1; i <= resolvedTotal; i++) {
            const p = chunkMap.get(i);
            if (!p || !p.dimensions || !Array.isArray(p.dimensions)) {
              missingChunks.push(i);
            } else if (p.dimensions.length === 0) {
              // Chunk present but dimensions array is empty
              incompleteDimensions.push({ chunk: i, count: 0 });
            }
          }

          // If any chunks missing critical dimensions field or have empty dimensions, fail loudly
          if (missingChunks.length > 0 || incompleteDimensions.length > 0) {
            console.error('[analyses/persist] CONTRACT VIOLATION: Chunks missing or incomplete dimensions', {
              analysisId,
              videoId,
              missingChunks,
              incompleteDimensions,
              totalExpected: resolvedTotal,
              totalReceived: finalChunks.length,
              receivedIndices: Array.from(chunkMap.keys()).sort()
            });
            const failureReport: PersistedValidationReport = {
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
            const errorMsg = missingChunks.length > 0
              ? `Chunk assembly failed: ${missingChunks.length} chunks missing dimensions`
              : `Chunk assembly failed: ${incompleteDimensions.length} chunks have empty dimensions`;
            return { type: 'error' as const, error: errorMsg, status: 400 };
          }

          const stitchedDimensions: any[] = [];
          let stitchedPersona: any = null;
          let stitchedClassification: any = null;
          let stitchedMonetization: any = null;
          const stitchedNodes: any[] = [];
          const stitchedEdges: any[] = [];

          for (let i = 1; i <= resolvedTotal; i++) {
            const p = chunkMap.get(i)!; // Guaranteed non-null by validation above
            if (p.dimensions && Array.isArray(p.dimensions)) {
              stitchedDimensions.push(...p.dimensions);
            }
            if (p.persona && !stitchedPersona) {
              stitchedPersona = p.persona;
            }
            if (p.classification && !stitchedClassification) {
              stitchedClassification = p.classification;
            }
            if (p.monetizationVerdict && !stitchedMonetization) {
              stitchedMonetization = p.monetizationVerdict;
            }
            if (p.knowledgeGraph && Array.isArray(p.knowledgeGraph.nodes)) {
              stitchedNodes.push(...p.knowledgeGraph.nodes);
            }
            if (p.knowledgeGraph && Array.isArray(p.knowledgeGraph.edges)) {
              stitchedEdges.push(...p.knowledgeGraph.edges);
            }
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

          const cleanDimensions = stitchedDimensions
            .filter(d => d && typeof d.number === 'number' && !isNaN(d.number))
            .sort((a, b) => a.number - b.number);

          const stitchedPayload: UCISPayloadV2 = {
            schemaVersion: '2.0',
            persona: stitchedPersona || {
              primary: { id: 'consultant', label: 'Consultant', weight: 1.0 },
              cognitiveLenses: [],
              selectionRationale: ''
            },
            dimensions: cleanDimensions,
            knowledgeGraph: {
              nodes: stitchedNodes,
              edges: stitchedEdges,
              rootId: stitchedNodes[0]?.id || null
            },
            classification: stitchedClassification || {
              authoritative: false,
              practicallyActionable: false,
              knowledgeGraphReady: false,
              safe: true,
              personaOptimised: false,
              recommendation: 'conditional'
            },
            monetizationVerdict: stitchedMonetization
          };

          const stitchedMarkdown = reconstructMarkdown(stitchedPayload);
          const fullParseResult = UCISPayloadV2Schema.safeParse(stitchedPayload);
          const isStitchedValid = fullParseResult.success;

          if (!isStitchedValid) {
            console.warn('[analyses/persist] Stitched payload failed schema validation', {
              analysisId,
              videoId,
              errors: fullParseResult.error.flatten()
            });
          }

          const finalStatus = isStitchedValid ? 'done' : 'failed';
          const newReport: PersistedValidationReport = {
            ...priorReport,
            status: finalStatus,
            model_used: model || null,
            valid: isStitchedValid,
          };

          await retryWithBackoff(
            () => persistenceAdapter.updateAnalysisResult({
              analysisId,
              markdown: stitchedMarkdown,
              payload: stitchedPayload,
              model: model || null,
              validationPassed: isStitchedValid,
              validationReport: newReport,
            }),
            2
          );

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
        }

        return { type: 'chunk_saved' as const, analysisId, chunkIndex };
      }

      // For chunked requests, verify all chunks have been persisted before deciding final status
      let finalStatus: string;
      let validationPassed: boolean;
      let finalMissingChunks: number[] = [];
      const expectsChunkSet = totalChunks !== undefined;

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
        const finalizedChunks = storedChunks ? storedChunks.filter(c => c.status === FINAL_STATUS) : [];
        const receivedIndices = new Set(finalizedChunks.map(c => c.chunk_index));

        let allReceived = true;
        const missing: number[] = [];
        for (let i = 1; i <= resolvedTotal; i++) {
          if (!receivedIndices.has(i)) {
            allReceived = false;
            missing.push(i);
          }
        }

        // Only mark as 'done' if ALL chunks have been persisted
        if (!allReceived) {
          finalStatus = 'partial';
          validationPassed = false;
          finalMissingChunks = missing;
          console.warn('[analyses/persist] Final check: incomplete chunk set prevents done status', {
            analysisId,
            videoId,
            missing,
            persisted: finalizedChunks.length,
            expected: resolvedTotal
          });
        } else {
          finalStatus = 'done';
          validationPassed = Boolean(valid);
        }
      } else {
        // Non-chunk finalization: accept valid/invalid status directly
        validationPassed = Boolean(valid);
        finalStatus = validationPassed ? 'done' : 'failed';
      }

      const newReport: PersistedValidationReport = {
        ...priorReport,
        status: finalStatus,
        model_used: model || null,
        valid: finalStatus === 'done' && validationPassed,
      };

      await retryWithBackoff(
        () => persistenceAdapter.updateAnalysisResult({
          analysisId,
          markdown,
          payload: validPayload ?? null,
          model: model || null,
          validationPassed,
          validationReport: newReport,
        }),
        2
      );

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
        analysis_markdown: markdown,
        analysis_payload: (validPayload ?? null) as Record<string, unknown> | null,
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
        hasMarkdown: !!markdown,
        hasPayload: !!validPayload,
        hasDimensions: validPayload && 'dimensions' in validPayload ? (validPayload.dimensions?.length ?? 0) : 0,
        hasKG: validPayload?.knowledgeGraph ? (validPayload.knowledgeGraph.nodes?.length ?? 0) + ' nodes' : 'none',
        cacheKey,
      });

      await setAnalysisCache(cacheKey, cachedPayload).catch(e => {
        Sentry.captureException(e, { contexts: { persist: { phase: 'cache_final_result', analysisId } } });
        console.warn('[analyses/persist] Failed to cache final result', { analysisId, error: String(e) });
      });

      if (transcriptAvailable) {
        await publishValidationTask({
          videoId,
          markdown,
          filename: buildValidationFilename(row.title, row.channelTitle),
          userId: row.userId,
          analysisId,
          metadata: { title: row.title, channelTitle: row.channelTitle || '' },
        }).catch(e => {
          Sentry.captureException(e, { contexts: { persist: { phase: 'publish_validation_task', analysisId } } });
          console.warn('[analyses/persist] Failed to publish validation task', { analysisId, error: String(e) });
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
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { 
      tags: { operation: 'analysis-persist' }, 
      contexts: { api: { endpoint: '/api/analyses/persist' } } 
    });
    console.error('[analyses/persist] Failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}