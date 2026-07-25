import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

export type RequireAdminResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 | 500; error: string };

/**
 * Shared admin gate for API routes: authenticate, then verify `users.role ===
 * 'admin'` with the service client (role isn't readable under anon RLS).
 * Extracted from the duplicated block in /api/admin/stats and
 * /api/admin/prompts/invalidate -- those two keep their inline copies to
 * avoid an unrelated diff; new admin routes should use this instead.
 */
export async function requireAdmin(routeTag: string): Promise<RequireAdminResult> {
  const authClient = await getSupabaseClientWithAuth();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const supabase = getSupabaseServiceClient();
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (userError) {
    Sentry.captureException(userError, {
      tags: { operation: 'admin_role_check', route: routeTag },
      contexts: { admin: { userId: user.id, operation: 'role_check' } },
    });
    return { ok: false, status: 500, error: 'Failed to verify admin status' };
  }

  if (!userData || userData.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, userId: user.id };
}
