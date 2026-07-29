export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { fetchSentryLogs } from '@/lib/admin-logs/fetchers';

/**
 * GET /api/admin/logs/sentry — Admin-only live fetch for unresolved Sentry
 * issues (hex-org/hex-yt-intel, EU region). Requires SENTRY_LOGS_AUTH_TOKEN
 * (event:read + project:read scope) -- distinct from the narrower
 * SENTRY_AUTH_TOKEN used only for sourcemap upload at build time.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/sentry:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }
  const { searchParams } = new URL(request.url);
  const result = await fetchSentryLogs(searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
