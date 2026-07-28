export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { fetchCloudflareLogs } from '@/lib/admin-logs/fetchers';

/**
 * GET /api/admin/logs/cloudflare — Admin-only live fetch for Cloudflare Worker execution logs
 * Queries Cloudflare GraphQL Analytics API (workersInvocationsAdaptive) using CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/cloudflare:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }
  const { searchParams } = new URL(request.url);
  const result = await fetchCloudflareLogs(searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
