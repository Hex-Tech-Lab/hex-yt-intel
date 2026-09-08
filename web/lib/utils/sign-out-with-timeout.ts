import type { SupabaseClient } from '@supabase/supabase-js';

/** Bounded wait before giving up on a slow/stuck signOut() call and
 *  navigating away regardless (live user report, 2026-09-08). Not a
 *  Settings Registry tunable -- this is a client-side UX safety net, not a
 *  server-enforced budget, and doesn't need to be adjustable without a
 *  redeploy. */
const SIGN_OUT_TIMEOUT_MS = 5000;

export type SignOutOutcome = 'success' | 'error' | 'timeout' | 'rejected';

// Module-scoped in-flight guard (race-condition-guard skill's "concurrent
// lazy-init / double-submit" pattern): clicking Sign Out twice before the
// first call settles -- or two mounted sign-out buttons (UserMenu +
// SidebarFooter) firing near-simultaneously -- would otherwise start two
// independent signOut()+timeout races. Neither is dangerous on its own
// (signOut() is safe to call twice, a duplicate router.push('/') is a
// no-op), but it's real wasted work with no guard today. Only the FIRST
// caller's promise does the work; every concurrent caller awaits the same
// one, matching Supabase's actual runtime semantics (one signed-in user,
// one real sign-out operation at a time).
let inFlight: Promise<SignOutOutcome> | null = null;

/**
 * Races Supabase's signOut() against a timeout so a hung/slow call never
 * blocks navigating away -- staying signed-in-looking after the user
 * explicitly asked to sign out is worse than a slow/failed server-side
 * revoke. Shared by UserMenu.tsx and DashboardContainer.tsx (previously
 * duplicated verbatim in both, including the literal 5000 -- deeper review,
 * PR #299).
 *
 * Real bug this also fixes: Supabase's signOut() RESOLVES with `{ error }`
 * on failure, it does not reject -- the original per-file implementations
 * raced signOut() via Promise.race and only handled a REJECTED promise via
 * catch, so a resolved `{ error }` (a genuinely failed sign-out) was
 * silently treated as success and the user was redirected as if it worked.
 */
export function signOutWithTimeout(
  supabase: SupabaseClient,
  logPrefix: string
): Promise<SignOutOutcome> {
  if (inFlight) return inFlight;
  inFlight = performSignOut(supabase, logPrefix).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function performSignOut(
  supabase: SupabaseClient,
  logPrefix: string
): Promise<SignOutOutcome> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve('timeout');
    }, SIGN_OUT_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([supabase.auth.signOut(), timeoutPromise]);
    if (result === 'timeout') {
      console.warn(`${logPrefix} signOut timed out after ${SIGN_OUT_TIMEOUT_MS}ms, navigating away regardless`);
      return 'timeout';
    }
    if (result.error) {
      console.warn(`${logPrefix} signOut resolved with an error, navigating away regardless:`, result.error.message);
      return 'error';
    }
    return 'success';
  } catch (err) {
    if (timedOut) return 'timeout';
    console.warn(`${logPrefix} signOut rejected, navigating away regardless:`, err);
    return 'rejected';
  } finally {
    // Efficiency review (/simplify, PR #299): a leaked timer when signOut()
    // wins the race first -- clear it so it doesn't sit on the event loop
    // for the remainder of SIGN_OUT_TIMEOUT_MS after we're already done.
    clearTimeout(timer!);
  }
}
