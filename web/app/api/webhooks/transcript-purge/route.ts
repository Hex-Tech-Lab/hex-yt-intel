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

    // TODO: Also purge corresponding Redis L1 transcript cache keys.
    // When a transcript is purged from Supabase, the worker's UpstashCacheAdapter
    // may still hold a cached copy under key `transcript:${videoId}` (72h TTL).
    // Add a `DEL transcript:${videoId}` call here via Upstash REST API to ensure
    // the purge is fully effective across both cache layers.
    // Example: await fetch(`${UPSTASH_REDIS_REST_URL}/del/transcript:${videoId}`, { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } });

    return NextResponse.json({ ok: true, purgedCount: purged.length, purged });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/webhooks/transcript-purge' } } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
