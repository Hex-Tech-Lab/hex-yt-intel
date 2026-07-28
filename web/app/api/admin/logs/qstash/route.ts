export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { fetchQstashLogs } from '@/lib/admin-logs/fetchers';

/**
 * GET /api/admin/logs/qstash — Admin-only live fetch for Upstash QStash event logs
 * Queries https://qstash.upstash.io/v2/events using QSTASH_TOKEN.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/qstash:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }
  const { searchParams } = new URL(request.url);
  const result = await fetchQstashLogs(searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
