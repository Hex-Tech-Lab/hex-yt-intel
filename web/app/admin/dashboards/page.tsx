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

  const service = getSupabaseServiceClient();
  const { data: userRow } = await service
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!userRow || userRow.role !== 'admin') {
    // Not an admin — send them to their normal dashboard.
    redirect('/dashboard');
  }

  return <AdminDashboardsClient />;
}
