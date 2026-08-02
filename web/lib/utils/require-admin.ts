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
    // No console.error/Sentry here previously -- unauthenticated hits on an
    // admin route are worth seeing in aggregate (broken client, probing,
    // or a bug in the calling code), but are routine/expected individually,
    // so 'warning' level to avoid alert fatigue.
    console.warn('[requireAdmin] Unauthenticated request', { route: routeTag });
    Sentry.captureMessage('requireAdmin: unauthenticated', {
      level: 'warning',
      tags: { operation: 'admin_auth_check', route: routeTag },
    });
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
    // A non-admin (or unknown) user hitting an admin route is exactly the
    // kind of thing worth knowing about in aggregate -- could be a broken
    // client, privilege-escalation probing, or a real bug upstream that
    // sent a non-admin user here. 'warning' level: routine/expected on its
    // own, but should be visible in Sentry, not just a debugger breakpoint.
    console.warn('[requireAdmin] Non-admin user denied', { route: routeTag, userId: user.id });
    Sentry.captureMessage('requireAdmin: forbidden (non-admin)', {
      level: 'warning',
      tags: { operation: 'admin_role_check', route: routeTag },
      contexts: { admin: { userId: user.id, role: userData?.role ?? null } },
    });
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, userId: user.id };
}
