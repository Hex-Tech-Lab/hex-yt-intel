export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * QStash Webhook: Upstash Redis/Vector telemetry poller.
 * Invoked on a schedule (every 15 min, see web/scripts/setup-qstash-cron.ts)
 * by Upstash QStash. Hits the same /info endpoints the admin log routes
 * (api/admin/logs/upstash-redis, api/admin/logs/upstash-vector) fetch live,
 * and persists one row per provider to public.upstash_snapshots so the Logs
 * console can show recent history, not just a point-in-time snapshot.
 * Signature-verified before doing any work.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash-client';
import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

interface PollResult {
  provider: 'redis' | 'vector';
  ok: boolean;
  stats: Record<string, unknown>;
  error?: string;
}

async function pollRedis(): Promise<PollResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return { provider: 'redis', ok: false, stats: {}, error: 'UPSTASH_REDIS_REST_URL/TOKEN not configured' };
  }
  try {
    const res = await fetch(`${url}/info`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { provider: 'redis', ok: false, stats: {}, error: `HTTP ${res.status}: ${errText}` };
    }
    const data = await res.json();
    const infoText = typeof data.result === 'string' ? data.result : JSON.stringify(data);
    // Parse the raw INFO-protocol text ("key:value" lines) into a flat object,
    // same field set the live admin-logs route already exposes.
    const stats: Record<string, unknown> = {};
    for (const line of infoText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf(':');
      if (idx === -1) continue;
      stats[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
    return { provider: 'redis', ok: true, stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { provider: 'redis', ok: false, stats: {}, error: message };
  }
}

async function pollVector(): Promise<PollResult> {
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token || url.includes('placeholder') || token.includes('mock')) {
    return { provider: 'vector', ok: false, stats: {}, error: 'UPSTASH_VECTOR_REST_URL/TOKEN missing or placeholder' };
  }
  try {
    const res = await fetch(`${url}/info`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { provider: 'vector', ok: false, stats: {}, error: `HTTP ${res.status}: ${errText}` };
    }
    const data = await res.json();
    const resultObj = (data.result || data) as Record<string, unknown>;
    return { provider: 'vector', ok: true, stats: resultObj };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { provider: 'vector', ok: false, stats: {}, error: message };
  }
}

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.clone().text();
    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);
    if (!verified) {
      console.warn('[upstash-snapshot-poll] QStash signature verification failed');
      return NextResponse.json({ error: 'Unauthorized: Invalid QStash signature' }, { status: 401 });
    }

    const [redisResult, vectorResult] = await Promise.all([pollRedis(), pollVector()]);
    const results = [redisResult, vectorResult];

    const supabase = getSupabaseServiceClient();
    const { error: insertError } = await supabase.from('upstash_snapshots').insert(
      results.map((r) => ({
        provider: r.provider,
        stats: r.stats,
        ok: r.ok,
        error: r.error ?? null,
      }))
    );

    if (insertError) {
      throw new Error(`Failed to insert upstash_snapshots rows: ${insertError.message}`);
    }

    console.log('[upstash-snapshot-poll] poll complete', {
      redis: redisResult.ok,
      vector: vectorResult.ok,
    });
    return NextResponse.json({ ok: true, results: results.map(({ provider, ok, error }) => ({ provider, ok, error })) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/webhooks/upstash-snapshot-poll' } } });
    console.error('[upstash-snapshot-poll] poll failed:', { message });
    return NextResponse.json({ error: message, code: 'ERR_UPSTASH_SNAPSHOT_POLL_FAILED' }, { status: 500 });
  }
}
