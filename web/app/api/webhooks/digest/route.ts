export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * QStash Webhook Handler: Executive Digest (Dimension 0) Generation
 *
 * Server-side counterpart to the client-triggered POST /api/analyses/digest --
 * see publishDigestTask in @/lib/qstash-client for the RCA. Idempotent
 * (GenerateExecutiveDigestUseCase skips generation if a digest already exists),
 * so this running is harmless even if the client-side trigger also fires.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { OpenRouterCompletionAdapter } from '@/lib/adapters/OpenRouterCompletionAdapter';
import { GenerateExecutiveDigestUseCase } from '@/lib/usecases/GenerateExecutiveDigestUseCase';
import { resolveChatCascade } from '@/lib/config/cascade';
import { verifyQStashSignature, type DigestPayload } from '@/lib/qstash-client';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: NextRequest) {
  let analysisId: string | undefined;

  try {
    const bodyText = await request.clone().text();

    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);
    if (!verified) {
      console.warn('[digest-webhook] QStash signature verification failed');
      return NextResponse.json({ error: 'Unauthorized: Invalid QStash signature' }, { status: 401 });
    }

    const payload: DigestPayload = JSON.parse(bodyText);
    analysisId = payload.analysisId;
    const { userId } = payload;

    if (!analysisId || !userId) {
      return NextResponse.json({ error: 'Missing required payload fields: analysisId or userId' }, { status: 400 });
    }

    const useCase = new GenerateExecutiveDigestUseCase(
      new SupabasePersistenceAdapter(),
      new OpenRouterCompletionAdapter()
    );

    const result = await useCase.execute({ analysisId, userId, models: await resolveChatCascade() });

    if (result.type === 'error') {
      // ERR_ANALYSIS_NOT_FOUND / not-yet-usable-markdown are not transient --
      // retrying won't help, so don't ask QStash to retry (200, not 503).
      console.warn('[digest-webhook] Digest generation returned error', {
        analysisId,
        code: result.code,
      });
      return NextResponse.json({ success: false, code: result.code }, { status: 200 });
    }

    console.log('[digest-webhook] Digest ready', { analysisId, cached: result.cached });
    return NextResponse.json({ success: true, analysisId, cached: result.cached });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[digest-webhook] UNHANDLED ERROR', { error: errorMsg, analysisId });
    Sentry.captureException(error, {
      tags: { service: 'webhook', operation: 'digest' },
      contexts: { analysis: { analysisId } },
    });
    // 503 so QStash retries -- this branch is for actual transient failures
    // (LLM call threw, DB write failed), unlike the ERR_ code branch above.
    return NextResponse.json({ error: errorMsg, success: false }, { status: 503 });
  }
}
