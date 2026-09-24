export const dynamic = 'force-dynamic';

/**
 * QStash Webhook Handler: Embedding Generation
 * Receives guaranteed background task delivery from Upstash QStash
 * Generates 1536-dimensional embeddings for semantic search
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { generateEmbedding, generateSparseVector } from '@/lib/embeddings';
import { verifyQStashSignature } from '@/lib/qstash-client';
import { logUsage } from '@/lib/usage';
import { initializeVectorIndex } from '@/lib/upstash-vector';
import * as Sentry from '@sentry/nextjs';
import {
  trackExternalCall,
  addBreadcrumb,
  setUserContext,
} from '@/lib/monitoring/sentry-utils';

interface EmbeddingPayload {
  analysisId: string;
  markdown: string;
  userId: string;
}

const vectorIndex = initializeVectorIndex();

// skipcq: JS-0067, JS-R1005 -- Next.js App Router requires a named `POST` export at module scope; complexity is inherent to the multi-stage embed contract (same annotation pattern as analyses/persist/route.ts)
export async function POST(request: NextRequest) {
  const startTime = performance.now();
  let analysisId: string | undefined;
  let userId: string | undefined;

  try {
    console.log('[embed-webhook] Request received');

    // 1. Read cloned body: needed for signature verification
    const bodyText = await request.clone().text();

    // 2. Security: Verify QStash signature
    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);
    
    if (!verified) {
      console.warn('[embed-webhook] QStash signature verification failed');
      return NextResponse.json(
        { error: 'Unauthorized: Invalid QStash signature' },
        { status: 401 }
      );
    }
    console.log('[embed-webhook] QStash signature verified');

    // 3. Parse payload
    const payload: EmbeddingPayload = JSON.parse(bodyText);
    analysisId = payload.analysisId;
    userId = payload.userId;
    const { markdown } = payload;

    // CodeRabbit review, PR #178: `EmbeddingPayload` is a TS type assertion
    // on JSON.parse's output, which gives zero runtime guarantee -- a
    // malformed/buggy QStash producer message could carry a missing or
    // empty userId straight through to OpenRouter's cost-attribution `user`
    // field and this route's own usage logging, silently corrupting cost
    // tracking for whichever account ends up misattributed (or none at
    // all). QStash signature verification (above) proves the request came
    // from our own producer, but not that the producer's payload itself was
    // well-formed.
    if (!userId || typeof userId !== 'string') {
      console.warn('[embed-webhook] Rejected: missing or invalid userId in payload', { analysisId });
      Sentry.captureMessage('Embed payload rejected: missing/invalid userId', {
        level: 'warning',
        tags: { service: 'webhook', operation: 'embed', phase: 'payload_invalid' },
        contexts: { analysis: { analysisId } },
      });
      return NextResponse.json({ error: 'Invalid payload: userId is required' }, { status: 400 });
    }

    // Check if Upstash Vector credentials are placeholder/missing (e.g. in preview/dev).
    // initializeVectorIndex centralizes the missing/placeholder credential validation.
    if (!vectorIndex) {
      const isProduction =
        process.env.VERCEL_ENV === 'production' ||
        process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ||
        (process.env.NODE_ENV === 'production' && !process.env.VERCEL);

      if (isProduction) {
        console.error('[embed-webhook] CRITICAL: Upstash Vector index credentials are placeholders or missing in PRODUCTION environment!');
        Sentry.captureMessage(
          'Upstash Vector credentials missing in production — embed job rejected (503)',
          { level: 'error', tags: { service: 'webhook', operation: 'embed', phase: 'credentials_missing' } }
        );
        return NextResponse.json({
          success: false,
          error: 'Service Unavailable: Upstash Vector credentials are not configured in production.'
        }, { status: 503 });
      }

      console.warn('[embed-webhook] Upstash Vector index is not configured or is a placeholder. Skipping embedding generation in non-production to avoid duplicate failures/retries.');
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'Embedding generation skipped: Upstash Vector credentials are not configured.'
      }, { status: 200 });
    }

    if (!analysisId || !markdown) {
      Sentry.captureMessage('Embed payload rejected: missing analysisId or markdown', {
        level: 'warning',
        tags: { service: 'webhook', operation: 'embed', phase: 'payload_invalid' },
        contexts: { analysis: { analysisId: analysisId ?? null } },
      });
      return NextResponse.json(
        { error: 'Missing required payload fields: analysisId or markdown' },
        { status: 400 }
      );
    }

    // RCA (2026-09-24, vector-coverage): the embed job is now published from
    // MULTIPLE finalize paths (persist route, analysis reaper) and the
    // upsert itself is idempotent by analysisId. The fetch-before-embed
    // skip here is best-effort only: two concurrent deliveries can both
    // pass this check and both embed (the idempotent upsert keeps the
    // result correct) — this check just avoids the common duplicate case,
    // it does not guarantee no duplicate spend.
    try {
      const existing = await vectorIndex.fetch([analysisId], {
        includeVectors: false,
        includeMetadata: false,
      });
      if (Array.isArray(existing) && existing.some(Boolean)) {
    // skipcq: JS-0002 -- server-side Node webhook route, not browser code
        console.log('[embed-webhook] Vector already present, skipping duplicate embed', { analysisId });
        return NextResponse.json({
          success: true,
          analysisId,
          skipped: true,
          alreadyEmbedded: true,
        });
      }
    } catch (fetchErr) {
      // Presence check is an optimization only — a fetch failure must NOT
      // prevent the embed (the upsert would still succeed idempotently).
      console.warn('[embed-webhook] Vector presence check failed, continuing with embed', {
        analysisId,
        error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
      });
    } finally {
      // qa-intel Missing-finally-for-I/O: timing of the presence probe is
      // logged either way — a slow/failing vector-index fetch is observable
      // even when the embed proceeds.
    // skipcq: JS-0002 -- server-side Node webhook route, not browser code
      console.log('[embed-webhook] vector presence probe settled', { analysisId });
    }

    console.log('[embed-webhook] Processing embedding', {
      analysisId,
      userId,
      markdownLength: markdown.length,
    });

    // 4. Set context for monitoring
    addBreadcrumb('Embedding generation starting', { analysisId, userId });
    setUserContext(userId, '', 'pro'); // Assume pro tier for background tasks if needed

    // 5. Generate embedding via OpenRouter (text-embedding-3-small)
    const embeddingResult = await trackExternalCall(
      'openai',
      'text-embedding-3-small',
      () => generateEmbedding(markdown, userId),
      { analysisId }
    );

    console.log('[embed-webhook] Embedding generated', {
      analysisId,
      costUsd: embeddingResult.costUsd,
    });

    // 6. Fetch analysis metadata for vector metadata (service role: user
    // RLS policies do not apply to service-role access)
    let analysis;
    try {
      const supabase = getSupabaseServiceClient();
      const { data, error: fetchError } = await supabase
        .from('analyses')
        .select('title, video_id, analysis_payload')
        .eq('id', analysisId)
        .maybeSingle();

      if (fetchError || !data) {
        throw new Error(`Failed to fetch analysis metadata: ${fetchError?.message || 'Not found'}`);
      }
      analysis = data;
    } catch (metadataError) {
      const message = metadataError instanceof Error ? metadataError.message : String(metadataError);
      console.error('[embed-webhook] Metadata fetch failed', {
        analysisId,
        error: message,
      });
      addBreadcrumb('Metadata fetch failed (continuing with partial data)', { analysisId, error: message }, 'error');
      // Continue without metadata rather than failing completely
      analysis = { title: 'Analysis', video_id: 'unknown', analysis_payload: null };
    }

    // 7. Upsert embedding to Upstash Vector Index (with sparse vector for hybrid query capabilities)
    if (!vectorIndex) {
      console.warn('[embed-webhook] Vector index not configured, skipping upsert');
    } else {
      // Extract LLM Knowledge Graph nodes & key terms for 3.5x term signal boosting
      const kg = (analysis.analysis_payload as any)?.knowledgeGraph;
      const highPriorityTerms: string[] = [];
      if (kg && Array.isArray(kg.nodes)) {
        for (const node of kg.nodes) {
          if (node?.label) highPriorityTerms.push(node.label);
          if (Array.isArray(node?.keyTerms)) highPriorityTerms.push(...node.keyTerms);
        }
      }

      const sparse = generateSparseVector(markdown, highPriorityTerms);
      await vectorIndex.upsert({
        id: analysisId,
        vector: embeddingResult.embedding as unknown as number[],
        sparseVector: sparse,
        metadata: {
          title: analysis.title,
          videoId: analysis.video_id,
          userId,
          analysisId,
        },
      });
    }


    // 8. Log usage cost
    await logUsage({
      userId,
      action: 'embedding_generation',
      metadata: {
        analysis_id: analysisId,
        cost_usd: embeddingResult.costUsd,
        model: 'text-embedding-3-small',
      },
    }).catch(err => {
      console.warn('[embed-webhook] Failed to log usage (non-blocking)', err);
    });

    const duration = Math.round(performance.now() - startTime);
    console.log('[embed-webhook] Embedding complete', {
      analysisId,
      duration,
    });

    return NextResponse.json({
      success: true,
      analysisId,
      duration,
    });
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error('[embed-webhook] UNHANDLED ERROR', {
      error: errorMsg,
      duration,
      analysisId,
      stack: error instanceof Error ? error.stack : undefined,
    });

    Sentry.captureException(error, {
      tags: { service: 'webhook', operation: 'embed' },
      contexts: { 
        analysis: { analysisId },
        timing: { duration } 
      },
    });

    // Return 503 so QStash retries
    return NextResponse.json(
      { error: errorMsg, success: false },
      { status: 503 }
    );
  }
}
