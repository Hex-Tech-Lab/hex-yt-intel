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

async function retryWithBackoff<T>(fn: () => Promise<T>, maxAttempts: number = 2): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError || new Error('Retry failed');
}

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
      status: z.string().optional().default(`completed`),
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
            status: status as any,
          }),
          2
        );

        const chunks = await retryWithBackoff(
          () => persistenceAdapter.findAnalysisChunks({ analysisId }),
          2
        );
        const COMPLETED_STATUS = `completed`;
        const completedChunks = chunks ? chunks.filter(c => c.status === COMPLETED_STATUS) : [];

        const completedIndexes = new Set(completedChunks.map(c => c.chunk_index));
        let allChunksCompleted = true;
        const missingChunks: number[] = [];
        for (let i = 1; i <= resolvedTotal; i++) {
          if (!completedIndexes.has(i)) {
            allChunksCompleted = false;
            missingChunks.push(i);
          }
        }

        let hitTimeout = false;
        if (!allChunksCompleted && completedChunks.length > 0) {
          const minQuorum = Math.ceil(resolvedTotal * 0.6);
          if (completedChunks.length >= minQuorum) {
            const now = Date.now();
            const timestamps = completedChunks.map((c: any) => new Date(c.updated_at).getTime());
            const newestTime = Math.max(...timestamps);
            if (now - newestTime >= 30000) {
              hitTimeout = true;
              if (missingChunks.length > 0) {
                console.warn('[analyses/persist] Chunk quorum timeout: missing chunks detected', {
                  analysisId,
                  videoId,
                  completedCount: completedChunks.length,
                  totalExpected: resolvedTotal,
                  missingChunkIndexes: missingChunks
                });
              }
            }
          }
        }

        if (hitTimeout && missingChunks.length > 0) {
          const partialReport: PersistedValidationReport = {
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
              validationReport: partialReport,
            }),
            2
          );

          return { type: 'partial_timeout' as const, analysisId, missingChunks };
        }

        if (allChunksCompleted) {
          const chunkMap = new Map<number, any>();
          completedChunks.forEach(c => {
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

      const newReport: PersistedValidationReport = {
        ...priorReport,
        status: isInterrupted ? 'interrupted' : 'done',
        model_used: model || null,
        valid: isInterrupted ? false : !!valid,
      };

      await retryWithBackoff(
        () => persistenceAdapter.updateAnalysisResult({
          analysisId,
          markdown,
          payload: validPayload ?? null,
          model: model || null,
          validationPassed: isInterrupted ? false : !!valid,
          validationReport: newReport,
        }),
        2
      );

      if (isInterrupted) {
        return { type: 'interrupted' as const, analysisId };
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