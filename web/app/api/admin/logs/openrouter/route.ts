export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { fetchOpenRouterLogs } from '@/lib/admin-logs/fetchers';

/**
 * GET /api/admin/logs/openrouter — Admin-only live fetch for OpenRouter
 * activity (per-model usage/cost) via the Management API's /v1/activity
 * endpoint. Requires OPENROUTER_MANAGEMENT_KEY (distinct from the regular
 * OPENROUTER_API_KEY used for inference).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/openrouter:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }
  const { searchParams } = new URL(request.url);
  const result = await fetchOpenRouterLogs(searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
