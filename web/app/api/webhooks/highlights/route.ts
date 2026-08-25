import { SupabaseTemporalGraphAdapter } from '@/lib/adapters/SupabaseTemporalGraphAdapter';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * QStash Webhook Handler: Highlights Extraction
 *
 * Server-side, finalize-triggered counterpart to highlights extraction.
 * Decoupled from the digest pass (RCA 2026-08-23: extraction rode the lazy
 * digest use case, which skips extraction entirely once a digest is cached --
 * a first-run failure became permanent; only 2 of 216 analyses had
 * highlights). This fires at analysis finalize via publishHighlightsTask,
 * while the transcript is guaranteed within its 72h retention window (ADR
 * 012). Idempotent via ExtractHighlightsUseCase's skipIfPresent short-circuit
 * (a re-publish on re-persist/re-remediation re-spends nothing if a set
 * already exists), so a redundant client-side or digest-fallback trigger is
 * harmless too.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { OpenRouterCompletionAdapter } from '@/lib/adapters/OpenRouterCompletionAdapter';
import { ExtractHighlightsUseCase } from '@/lib/usecases/ExtractHighlightsUseCase';
import { resolveDigestCascade } from '@/lib/config/cascade';
import { verifyQStashSignature, type HighlightsPayload } from '@/lib/qstash-client';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: NextRequest) {
  let analysisId: string | undefined;

  try {
    const bodyText = await request.clone().text();

    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);
    if (!verified) {
      console.warn('[highlights-webhook] QStash signature verification failed');
      return NextResponse.json({ error: 'Unauthorized: Invalid QStash signature' }, { status: 401 });
    }

    const payload: HighlightsPayload = JSON.parse(bodyText);
    analysisId = payload.analysisId;
    const { userId, videoId } = payload;

    if (!analysisId || !userId || !videoId) {
      return NextResponse.json(
        { error: 'Missing required payload fields: analysisId, userId, or videoId' },
        { status: 400 }
      );
    }

    const useCase = new ExtractHighlightsUseCase(
      new SupabasePersistenceAdapter(),
      new OpenRouterCompletionAdapter(),
      new SupabaseTemporalGraphAdapter()
    );

    await useCase.execute({
      analysisId,
      videoId,
      models: await resolveDigestCascade(),
      // skipIfPresent defaults true -- idempotent against re-publish. A
      // previous finalize/attempt that already produced a set is left alone.
    });

    console.log('[highlights-webhook] Extraction pass complete', { analysisId });
    return NextResponse.json({ success: true, analysisId });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[highlights-webhook] UNHANDLED ERROR', { error: errorMsg, analysisId });
    Sentry.captureException(error, {
      tags: { service: 'webhook', operation: 'highlights' },
      contexts: { analysis: { analysisId } },
    });
    // 503 so QStash retries -- transient failures (LLM down, DB write failed).
    return NextResponse.json({ error: errorMsg, success: false }, { status: 503 });
  }
}
