export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/admin/logs/upstash-redis — Admin-only live fetch for Upstash Redis database stats
 * Queries UPSTASH_REDIS_REST_URL /info to retrieve real-time Redis telemetry.
 * Pass ?history=1 to also return recent polled snapshots from
 * public.upstash_snapshots (populated every 15 min by the
 * upstash-snapshot-poll QStash job) for trend/troubleshooting purposes.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/upstash-redis:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const wantHistory = request.nextUrl.searchParams.get('history') === '1';
  let history: Array<{ polledAt: string; ok: boolean; stats: Record<string, unknown>; error: string | null }> = [];
  if (wantHistory) {
    try {
      const supabase = getSupabaseServiceClient();
      const { data, error } = await supabase
        .from('upstash_snapshots')
        .select('polled_at, ok, stats, error')
        .eq('provider', 'redis')
        .order('polled_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      history = (data || []).map((row) => ({
        polledAt: row.polled_at,
        ok: row.ok,
        stats: row.stats,
        error: row.error,
      }));
    } catch (error) {
      Sentry.captureException(error, { tags: { operation: 'admin_upstash_redis_history' } });
      console.error('[admin/logs/upstash-redis] failed to load history:', error);
    }
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return NextResponse.json(
      { error: 'UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not configured.' },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(`${url}/info`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upstash Redis REST API returned ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const infoText = typeof data.result === 'string' ? data.result : JSON.stringify(data);

    const timeIso = new Date().toISOString();
    const lines = infoText.split('\n').filter((l: string) => l.trim().length > 0 && !l.startsWith('#'));
    const formatted = lines.map((l: string) => `[${timeIso}] [INFO] [redis:stat] ${l.trim()}`).join('\n');

    return NextResponse.json({
      totalEntries: lines.length,
      logs: formatted || `[${timeIso}] [INFO] Redis info query completed with no output lines.`,
      rawInfo: infoText,
      ...(wantHistory ? { history } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_upstash_redis_logs' } });
    return NextResponse.json({ error: `Failed to fetch Upstash Redis stats: ${message}` }, { status: 500 });
  }
}
