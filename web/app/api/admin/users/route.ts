export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { requireAdmin } from '@/lib/utils/require-admin';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/admin/users -- list every user with signup date, tier, analyses
 * count, and last-session IP/user-agent (from auth.sessions, which isn't in
 * PostgREST's exposed schema list, so it's reached via the
 * admin_list_users_activity() SECURITY DEFINER RPC instead). Built after an
 * unexplained pre-launch login (2026-07-30) had no standing way to answer
 * "who signed up, what did they touch."
 *
 * Must call the RPC with the caller's authenticated client, not the service
 * client -- the function checks auth.uid() internally, which resolves to
 * NULL under the service role and would always raise 'forbidden'.
 */
export async function GET(): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/users:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const supabase = await getSupabaseClientWithAuth();
  const { data, error } = await supabase.rpc('admin_list_users_activity');

  if (error) {
    Sentry.captureException(error, { tags: { operation: 'admin_list_users_activity' } });
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }

  return NextResponse.json({ users: data ?? [] });
}
