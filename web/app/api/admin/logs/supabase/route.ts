export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { fetchSupabaseLogs } from '@/lib/admin-logs/fetchers';

/**
 * GET /api/admin/logs/supabase — Admin-only live fetch for Supabase Management API logs
 * Queries https://api.supabase.com/v1/projects/{ref}/logs when SUPABASE_ACCESS_TOKEN is present.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/supabase:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }
  const { searchParams } = new URL(request.url);
  const result = await fetchSupabaseLogs(searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
