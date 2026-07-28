export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { fetchSynthesisLogs } from '@/lib/admin-logs/fetchers';

/**
 * GET /api/admin/logs/synthesis — Admin-only live fetch for in-app synthesis logs
 * Queries public.analyses and public.comment_sample_runs by time range.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/synthesis:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }
  const { searchParams } = new URL(request.url);
  const result = await fetchSynthesisLogs(searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
