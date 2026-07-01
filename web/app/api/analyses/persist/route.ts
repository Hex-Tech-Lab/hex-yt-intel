export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
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

/**
 * Retry async operation with exponential backoff (2^n * 1000ms) and randomized jitter.
 * Jitter prevents thundering herd: with 5 concurrent streams retrying at identical times,
 * all would hammer the database simultaneously. Jitter spreads them across staggered intervals.
 * @template T The return type of the async function
 * @param fn The async function to retry
 * @param maxAttempts Maximum number of retry attempts (default: 2)
 * @returns The result of the successful function call
 */
const retryWithBackoff = async <T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> => {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        // Base delay with exponential backoff: 1s for attempt 1, 2s for attempt 2, etc.
        const baseDelayMs = Math.pow(2, attempt - 1) * 1000;
        // Jitter: randomize ±50% around base delay to prevent synchronized retry waves
        // For baseDelayMs=1000: jitter range is [500, 1500]
        // For baseDelayMs=2000: jitter range is [1000, 3000]
        const jitterFactor = 0.5 + Math.random(); // Range: [0.5, 1.5]
        const delayMs = Math.floor(baseDelayMs * jitterFactor);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError || new Error('Retry failed');
};

function buildValidationFilename(title: string, channelTitle?: string | null): string {
  const cleanSlug = (text: string): string => {
    return text
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      || 'unknown';
  };
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
        status,
        chunkIndex,
        totalChunks
      } = parsedBody.data;

      const resolvedTotal = totalChunks ?? TOTAL_STREAMS;

      const canonical = JSON.stringify({ markdown, payload: payload ?? null });
      let isSigValid = false;
      try {
        isSigValid = await verifyContentSig(canonical, contentSig);
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
            const chunkTimes = finalChunks.map((c: any) => new Date(c.updated_at).getTime());
            const latestChunkTime = Math.max(...chunkTimes);
            const elapsedMs = currentTime - latestChunkTime;

            if (elapsedMs >= 30000) {
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

          const stitchedDimensions: any[] = [];
          let stitchedPersona: any = null;
          let stitchedClassification: any = null;
          let stitchedMonetization: any = null;
          const stitchedNodes: any[] = [];
          const stitchedEdges: any[] = [];

          for (let i = 1; i <= resolvedTotal; i++) {
            const p = chunkMap.get(i) || {};
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
          const cacheKey = generateCacheKey('edge-stream', stitchedMarkdown, '5.1');
          await setAnalysisCache(cacheKey, cachedPayload).catch(() => {});

          if (!!priorReport.transcript_available) {
            await publishValidationTask({
              videoId,
              markdown: stitchedMarkdown,
              filename: buildValidationFilename(row.title, row.channelTitle),
              userId: row.userId,
              analysisId,
              metadata: { title: row.title, channelTitle: row.channelTitle || '' },
            }).catch(() => {});
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
        analysis_payload: (payload ?? null) as Record<string, unknown> | null,
        validation_report: {
          transcript_available: !!priorReport.transcript_available,
          analysis_type: (priorReport.analysis_type as 'full' | 'metadata-only') || 'full',
        },
        model_used: model || 'edge-stream',
        created_at: row.createdAt,
        cached_at: new Date().toISOString(),
      };
      const cacheKey = generateCacheKey('edge-stream', markdown, '5.1');
      await setAnalysisCache(cacheKey, cachedPayload).catch(() => {});

      if (transcriptAvailable) {
        await publishValidationTask({
          videoId,
          markdown,
          filename: buildValidationFilename(row.title, row.channelTitle),
          userId: row.userId,
          analysisId,
          metadata: { title: row.title, channelTitle: row.channelTitle || '' },
        }).catch(() => {});
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