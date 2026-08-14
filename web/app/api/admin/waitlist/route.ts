export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { requireAdmin } from '@/lib/utils/require-admin';

/**
 * GET /api/admin/waitlist -- list every waitlist signup. anon has zero
 * privileges on waitlist_signups (migration 20260813081336), so unlike
 * /api/admin/users this doesn't need a SECURITY DEFINER RPC -- the
 * service-role client already bypasses RLS entirely for a simple table read.
 */
export async function GET(): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/waitlist:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('waitlist_signups')
    .select('id, email, source, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    Sentry.captureException(error, { tags: { operation: 'admin_list_waitlist_signups' } });
    return NextResponse.json({ error: error.message || 'Failed to load waitlist signups' }, { status: 500 });
  }

  const signups = data ?? [];
  const uniqueEmails = new Set(signups.map((row) => row.email.toLowerCase())).size;

  return NextResponse.json({
    signups,
    total: signups.length,
    uniqueEmails,
  });
}
