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
    const purged = await SupabaseTranscriptAdapter.purgeExpired();
    console.log('[transcript-purge] purged', purged.length);

    // P0-3: purge expired chapter rows (both real chapters and the
    // attempted-but-empty sentinel) on the same cron schedule as transcripts.
    // Isolated in its own try/catch (PR #205 review, 2026-08-05): the
    // transcript purge above already committed its DB deletes by this
    // point -- a chapters-purge failure shouldn't turn the whole response
    // into a 500 and obscure that the transcript purge genuinely succeeded.
    let purgedChaptersCount: number | null = null;
    try {
      const purgedChapters = await SupabaseTranscriptAdapter.purgeExpiredChapters();
      purgedChaptersCount = purgedChapters.length;
      console.log('[transcript-purge] purged chapters', purgedChaptersCount);
    } catch (chaptersError) {
      Sentry.captureException(chaptersError, { contexts: { api: { endpoint: '/api/webhooks/transcript-purge', phase: 'chapters' } } });
      console.error('[transcript-purge] chapters purge failed, transcript purge still reported', chaptersError);
    }

    // Purge corresponding Redis L1 transcript cache keys (72h TTL, set in worker).
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const redisPurgeResults: { videoId: string; redisDeleted: boolean }[] = [];

    if (redisUrl && redisToken) {
      for (const { videoId } of purged) {
        try {
          const response = await fetch(`${redisUrl}/del/transcript:${videoId}`, {
            headers: { Authorization: `Bearer ${redisToken}` },
          });
          const ok = response.ok;
          redisPurgeResults.push({ videoId, redisDeleted: ok });
          console.log(
            `[transcript-purge] Redis L1 ${ok ? 'DELETED' : 'FAILED'} transcript:${videoId}`,
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          redisPurgeResults.push({ videoId, redisDeleted: false });
          console.error(`[transcript-purge] Redis L1 DELETE error for transcript:${videoId}: ${msg}`);
          Sentry.captureException(error, {
            contexts: { cache: { videoId, key: `transcript:${videoId}` } },
          });
        }
      }
    } else {
      console.warn(
        '[transcript-purge] Skipping Redis L1 purge: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not configured',
      );
    }

    return NextResponse.json({
      ok: true,
      purgedCount: purged.length,
      purged,
      redisPurgeResults,
      purgedChaptersCount,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/webhooks/transcript-purge' } } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
