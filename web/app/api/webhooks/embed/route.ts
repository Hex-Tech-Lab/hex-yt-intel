/**
 * QStash Webhook Handler: Embedding Generation
 * Receives guaranteed background task delivery from Upstash QStash
 * Generates 1536-dimensional embeddings for semantic search
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { generateEmbedding } from '@/lib/embeddings';
import { verifyQStashSignature } from '@/lib/qstash-client';
import { logUsage } from '@/lib/usage';
import * as Sentry from '@sentry/nextjs';
import {
  trackExternalCall,
  trackDatabaseQuery,
  addBreadcrumb,
  setUserContext,
} from '@/lib/monitoring/sentry-utils';

interface EmbeddingPayload {
  analysisId: string;
  markdown: string;
  userId: string;
}

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

    if (!analysisId || !markdown) {
      return NextResponse.json(
        { error: 'Missing required payload fields: analysisId or markdown' },
        { status: 400 }
      );
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
      () => generateEmbedding(markdown),
      { analysisId }
    );

    console.log('[embed-webhook] Embedding generated', {
      analysisId,
      costUsd: embeddingResult.costUsd,
    });

    // 6. Save embedding to database
    const supabase = getSupabaseClient();
    await trackDatabaseQuery(
      'update',
      'analyses',
      async () => {
        const { error } = await supabase
          .from('analyses')
          .update({
            embedding: embeddingResult.embedding,
            updated_at: new Date().toISOString(),
          })
          .eq('id', analysisId);

        if (error) throw error;
      },
      { analysisId }
    );

    // 7. Log usage cost
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
