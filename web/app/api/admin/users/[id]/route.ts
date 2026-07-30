export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';
import { requireAdmin } from '@/lib/utils/require-admin';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/admin/users/[id] -- per-user drill-down for the admin User
 * Activity dashboard: session history (auth.sessions, via RPC -- see
 * admin/users/route.ts for why), videos analyzed, and report-download
 * events (usage_logs action='report_download', added 2026-07-30 -- no
 * download event existed before that).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/users/[id]:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const { id: targetUserId } = await context.params;

  const authClient = await getSupabaseClientWithAuth();
  const service = getSupabaseServiceClient();

  const [sessionsResult, analysesResult, downloadsResult] = await Promise.all([
    authClient.rpc('admin_get_user_sessions', { target_user_id: targetUserId }),
    service
      .from('analyses')
      .select('id, video_id, title, channel_title, billing_status, created_at')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false }),
    service
      .from('usage_logs')
      .select('id, action, metadata, created_at')
      .eq('user_id', targetUserId)
      .eq('action', 'report_download')
      .order('created_at', { ascending: false }),
  ]);

  if (sessionsResult.error) {
    Sentry.captureException(sessionsResult.error, { tags: { operation: 'admin_get_user_sessions' }, contexts: { admin: { targetUserId } } });
  }
  if (analysesResult.error) {
    Sentry.captureException(analysesResult.error, { tags: { operation: 'admin_user_analyses' }, contexts: { admin: { targetUserId } } });
  }
  if (downloadsResult.error) {
    Sentry.captureException(downloadsResult.error, { tags: { operation: 'admin_user_downloads' }, contexts: { admin: { targetUserId } } });
  }

  return NextResponse.json({
    sessions: sessionsResult.data ?? [],
    analyses: analysesResult.data ?? [],
    downloads: downloadsResult.data ?? [],
  });
}
