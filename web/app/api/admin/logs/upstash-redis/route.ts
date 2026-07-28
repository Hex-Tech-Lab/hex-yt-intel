export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { fetchUpstashRedisLogs } from '@/lib/admin-logs/fetchers';

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
  const result = await fetchUpstashRedisLogs(request.nextUrl.searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
