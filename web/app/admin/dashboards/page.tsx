import { redirect } from 'next/navigation';
import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';
import { AdminDashboardsClient } from './AdminDashboardsClient';

export const dynamic = 'force-dynamic';

/**
 * Server-side admin gate. Mirrors the /api/admin/stats handler: authenticate the
 * user, then verify `users.role === 'admin'` with the service client (role is not
 * readable under anon RLS). Non-admins never reach the client dashboard.
 */
export default async function AdminDashboardsPage() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/signin');
  }

  // Resolve the caller's role. A transient DB error or a missing service-role key
  // must NOT be silently treated as "not an admin" (that would lock real admins
  // out) — fail closed to the error page instead. redirect() throws NEXT_REDIRECT,
  // so keep those calls OUTSIDE the try/catch.
  let role: string | null = null;
  let roleLookupFailed = false;
  try {
    const service = getSupabaseServiceClient();
    const { data: userRow, error } = await service
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    role = userRow?.role ?? null;
  } catch (err) {
    console.error('[admin/dashboards] role lookup failed', err instanceof Error ? err.message : String(err));
    roleLookupFailed = true;
  }

  if (roleLookupFailed) {
    redirect('/auth/error?error=admin_check_failed');
  }

  if (role !== 'admin') {
    // Not an admin — send them to their normal dashboard.
    redirect('/dashboard');
  }

  return <AdminDashboardsClient />;
}
