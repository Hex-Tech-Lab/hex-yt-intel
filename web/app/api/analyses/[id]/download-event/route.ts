export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { logUsage } from '@/lib/usage';

/**
 * POST /api/analyses/[id]/download-event -- fire-and-forget beacon for the
 * client-side markdown Blob download (DashboardContainer.tsx's handleExport
 * 'markdown' branch), which has no server round-trip of its own and so was
 * previously invisible to the admin User Activity dashboard's download
 * tracking. The PDF path logs server-side directly in export/route.ts;
 * this route exists only because the MD path can't.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: analysisId } = await context.params;

  const authClient = await getSupabaseClientWithAuth();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ok = await logUsage({ userId: user.id, action: 'report_download', metadata: { analysisId, format: 'markdown' } });
  if (!ok) {
    return NextResponse.json({ error: 'Failed to log' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
