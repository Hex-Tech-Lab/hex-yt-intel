export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash-client';
import { SupabaseTranscriptAdapter } from '@/lib/adapters/SupabaseTranscriptAdapter';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.clone().text();
    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await SupabaseTranscriptAdapter.complianceCheck();
    if (result.violations > 0) {
      Sentry.captureMessage('transcript compliance violation', {
        level: 'error',
        tags: { operation: 'compliance-check' },
        extra: { violations: result.violations, maxAge: result.maxAge },
      });
      console.error('[compliance-check] VIOLATIONS', result);
    } else {
      console.log('[compliance-check] ok, no violations');
    }

    // Same 72h-TTL compliance check for transcript_chapters (added alongside
    // P0-3's purge-cron wiring) -- without this, an expired-chapter leak (if
    // the purge cron ever lags or fails) would never surface a Sentry alert
    // the way a transcript-retention leak already does. Isolated in its own
    // try/catch (PR #205 review, 2026-08-05): this check throwing (a missing
    // grant, an unapplied migration, a transient RPC failure) must not turn
    // the whole endpoint into a 500 and discard the transcript result
    // already computed above -- these are two independent compliance
    // checks, not one atomic unit.
    let chaptersResult: { violations: number; maxAge: string | null } | { error: string };
    try {
      chaptersResult = await SupabaseTranscriptAdapter.complianceCheckChapters();
      if (chaptersResult.violations > 0) {
        Sentry.captureMessage('transcript chapters compliance violation', {
          level: 'error',
          tags: { operation: 'compliance-check-chapters' },
          extra: { violations: chaptersResult.violations, maxAge: chaptersResult.maxAge },
        });
        console.error('[compliance-check] CHAPTER VIOLATIONS', chaptersResult);
      } else {
        console.log('[compliance-check] chapters ok, no violations');
      }
    } catch (chaptersError) {
      Sentry.captureException(chaptersError, { contexts: { api: { endpoint: '/api/webhooks/compliance-check', phase: 'chapters' } } });
      console.error('[compliance-check] chapters check failed, transcript result still reported', chaptersError);
      chaptersResult = { error: chaptersError instanceof Error ? chaptersError.message : String(chaptersError) };
    }

    return NextResponse.json({
      ok: true,
      ...result,
      chapters: chaptersResult,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/webhooks/compliance-check' } } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
