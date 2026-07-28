export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { fetchVercelLogs } from '@/lib/admin-logs/fetchers';

/**
 * GET /api/admin/logs/vercel — Admin-only live fetch for Vercel deployment logs
 * Queries Vercel REST API when VERCEL_TOKEN and VERCEL_PROJECT_ID are present.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/vercel:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }
  const { searchParams } = new URL(request.url);
  const result = await fetchVercelLogs(searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
