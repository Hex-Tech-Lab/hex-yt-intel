export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/admin/logs/upstash-vector — Admin-only live fetch for Upstash Vector index info/stats
 * Queries UPSTASH_VECTOR_REST_URL/info using UPSTASH_VECTOR_REST_TOKEN.
 * Pass ?history=1 to also return recent polled snapshots from
 * public.upstash_snapshots (populated every 15 min by the
 * upstash-snapshot-poll QStash job) for trend/troubleshooting purposes.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/upstash-vector:GET');
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
        .eq('provider', 'vector')
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
      Sentry.captureException(error, { tags: { operation: 'admin_upstash_vector_history' } });
      console.error('[admin/logs/upstash-vector] failed to load history:', error);
    }
  }

  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;

  if (!url || !token || url.includes('placeholder') || token.includes('mock')) {
    return NextResponse.json(
      { error: 'UPSTASH_VECTOR_REST_URL or UPSTASH_VECTOR_REST_TOKEN is missing or set to placeholder/mock value.' },
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
      throw new Error(`Upstash Vector REST API returned ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const resultObj = data.result || data;

    const timeIso = new Date().toISOString();
    const lines = Object.entries(resultObj).map(([k, v]) => `[${timeIso}] [INFO] [vector:info] ${k}=${JSON.stringify(v)}`);
    const formatted = lines.join('\n');

    return NextResponse.json({
      totalEntries: lines.length,
      logs: formatted || `[${timeIso}] [INFO] Upstash Vector index query completed cleanly.`,
      result: resultObj,
      ...(wantHistory ? { history } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_upstash_vector_logs' } });
    return NextResponse.json({ error: `Failed to fetch Upstash Vector stats: ${message}` }, { status: 500 });
  }
}
