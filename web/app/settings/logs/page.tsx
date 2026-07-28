import { redirect } from 'next/navigation';
import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';
import { LogsViewerClient } from './LogsViewerClient';

export const dynamic = 'force-dynamic';

/**
 * Server-side admin gate for /settings/logs
 * Strictly checks user authentication and admin role in users table.
 */
export default async function SettingsLogsPage() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/signin');
  }

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
    console.error('[settings/logs] role lookup failed', err instanceof Error ? err.message : String(err));
    roleLookupFailed = true;
  }

  if (roleLookupFailed) {
    redirect('/auth/error?error=admin_check_failed');
  }

  if (role !== 'admin') {
    redirect('/dashboard');
  }

  return <LogsViewerClient />;
}
