import * as Sentry from '@sentry/nextjs';
import { getSupabaseServiceClient } from '@/lib/supabase';

/**
 * Best-effort write to `public.activity_log` -- never blocks or fails the
 * caller's real operation if logging itself errors (e.g. table unreachable).
 * Fire-and-forget: callers should NOT await this on their response's
 * critical path (see ShareButton/createLink -- a real user-facing action
 * shouldn't wait on an audit write).
 *
 * Supabase's `.insert()` resolves with `{ error }` on a DB-level failure
 * (RLS, schema, constraint) rather than throwing, so both the returned
 * error and a thrown exception are reported the same way (real gap found
 * 2026-08-20, automated PR review -- this was duplicated ad hoc in two
 * call sites before being extracted here).
 */
export async function logActivityBestEffort(
  category: string,
  detail: Record<string, unknown>,
  sentryTag: string
): Promise<void> {
  try {
    const service = getSupabaseServiceClient();
    const { error: logError } = await service.from('activity_log').insert({ category, detail });
    if (logError) {
      Sentry.captureMessage(`[${sentryTag}] activity_log insert returned an error`, {
        level: 'warning',
        tags: { operation: sentryTag },
        extra: { message: logError.message, code: logError.code, category },
      });
      console.warn(`[${sentryTag}] activity_log write returned an error:`, logError.message);
    }
  } catch (logErr) {
    console.warn(`[${sentryTag}] activity_log write failed:`, logErr instanceof Error ? logErr.message : String(logErr));
  }
}
