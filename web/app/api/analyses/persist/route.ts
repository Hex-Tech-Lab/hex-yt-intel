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
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

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
      status: z.string().optional().default('completed'),
      chunkIndex: z.number().int().min(1).max(TOTAL_DIMENSIONS).optional(),
      totalChunks: z.number().int().refine((val) => val === TOTAL_DIMENSIONS, {
        message: `totalChunks must match active configuration matrix of ${TOTAL_DIMENSIONS}`,
      }),
    });

    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json({ 
        error: 'Invalid request payload schema', 
        details: parsedBody.error.flatten() 
      }, { status: 400 });
    }

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

    const resolvedTotal = totalChunks;
    if (chunkIndex !== undefined) {
      if (chunkIndex < 1 || chunkIndex > resolvedTotal) {
        return NextResponse.json({ error: `Invalid chunkIndex. Must be an integer between 1 and ${resolvedTotal}` }, { status: 400 });
      }
    }

    // Tamper check: proves this markdown+payload came from the worker, not a forged caller.
    // Canonical signable matches the worker's canonical = JSON.stringify({ markdown, payload }).
    const canonical = JSON.stringify({ markdown, payload: payload ?? null });
    if (!verifyContentSig(canonical, contentSig)) {
      console.warn('[analyses/persist] Invalid content signature', { analysisId, videoId });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Validate payload schema before persisting.
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
        return NextResponse.json({ error: 'Invalid payload schema' }, { status: 400 });
      }
      validPayload = parseResult.data as any;
    }

    const persistenceAdapter = new SupabasePersistenceAdapter();

    // Fetch the processing row to recover its context (user, transcript availability).
    const row = await persistenceAdapter.findAnalysisForPersist({ analysisId, videoId });

    if (!row) {
      Sentry.captureMessage('analysis-persist: row not found', {
        level: 'warning',
        tags: { operation: 'analysis-persist', reason: 'row-not-found' },
        extra: { analysisId, videoId, status },
      });
      console.warn('[analyses/persist] Row not found (env mismatch?)', { analysisId, videoId });
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const priorReport: PersistedValidationReport = isPersistedValidationReport(row.validationReport) 
      ? row.validationReport 
      : { status: 'processing' };
    const isInterrupted = status === 'interrupted';

    // === CHUNKED PERSISTENCE PATH ===
    if (chunkIndex !== undefined && validPayload && 'dimensions' in validPayload) {
      const dimensionsCovered = Array.isArray(validPayload.dimensions)
        ? (validPayload.dimensions as any[]).map((d: any) => d.number)
        : [];

      // Save the segment chunk to the database
      await persistenceAdapter.persistAnalysisChunk({
        analysisId,
        chunkIndex,
        dimensionsCovered,
        payload,
        status: status as any,
      });

      // Query all chunks to see if we can perform a stitch
      const chunks = await persistenceAdapter.findAnalysisChunks({ analysisId });
      const completedChunks = chunks ? chunks.filter(c => c.status === 'completed') : [];

      const completedIndexes = new Set(completedChunks.map(c => c.chunk_index));
      let allChunksCompleted = true;
      for (let i = 1; i <= resolvedTotal; i++) {
        if (!completedIndexes.has(i)) {
          allChunksCompleted = false;
          break;
        }
      }

      if (allChunksCompleted) {
        // Stitch the payloads together
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

        // Sort dimensions safely by dimension number, filtering out malformed entries
        const cleanDimensions = stitchedDimensions
          .filter(d => d && typeof d.number === 'number' && !isNaN(d.number))
          .sort((a, b) => a.number - b.number);

        const stitchedPayload: UCISPayloadV2 = {
          schemaVersion: '2.0',
          persona: stitchedPersona || {
            primary: { id: 'analyst', label: 'Analyst', weight: 1.0 },
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

        const newReport: PersistedValidationReport = {
          ...priorReport,
          status: isStitchedValid ? 'completed' : 'failed',
          model_used: model || null,
          valid: isStitchedValid,
        };

        // Write complete stitched result to main tables
        await persistenceAdapter.updateAnalysisResult({
          analysisId,
          markdown: stitchedMarkdown,
          payload: stitchedPayload,
          model: model || null,
          validationPassed: isStitchedValid,
          validationReport: newReport,
        });

        // Write knowledge graph entities & relations to the KG tables
        if (stitchedPayload.knowledgeGraph && Array.isArray(stitchedPayload.knowledgeGraph.nodes)) {
          const entities = stitchedPayload.knowledgeGraph.nodes.map((n: any) => ({
            label: n.label,
            type: n.entityType || n.type || 'concept',
            weight: typeof n.weight === 'number' ? n.weight : 1,
          }));
          const relations = stitchedPayload.knowledgeGraph.edges.map((e: any) => ({
            source: e.source,
            target: e.target,
            relation: e.kind || e.relation || 'related',
            strength: typeof e.strength === 'number' ? e.strength : 1,
          }));

          await persistenceAdapter.persistKnowledgeGraph({
            analysisId,
            entities,
            relations,
          }).catch((err) => {
            console.error('[analyses/persist] Failed to persist stitched KG:', err);
          });
        }

        // Cache-aside updates
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

        // QStash verification queue
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

      return NextResponse.json({ ok: true, analysisId, chunkIndex, status: 'chunk_saved' });
    }

    // === BASELINE FULL PERSISTENCE PATH (Legacy/Single Stream fallback) ===
    const newReport: PersistedValidationReport = {
      ...priorReport,
      status: isInterrupted ? 'interrupted' : 'done',
      model_used: model || null,
      valid: isInterrupted ? false : !!valid,
    };

    await persistenceAdapter.updateAnalysisResult({
      analysisId,
      markdown,
      payload: validPayload ?? null,
      model: model || null,
      validationPassed: isInterrupted ? false : !!valid,
      validationReport: newReport,
    });

    if (isInterrupted) {
      return NextResponse.json({ ok: true, analysisId, status: 'interrupted' });
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

    return NextResponse.json({ ok: true, analysisId });
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