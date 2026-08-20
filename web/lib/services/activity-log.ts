import * as Sentry from '@sentry/nextjs';
import { getSupabaseServiceClient } from '@/lib/supabase';

/**
 * Best-effort write to `public.activity_log` -- never blocks or fails the
 * caller's real operation if logging itself errors (e.g. table unreachable).
 * Callers await this (this app has no established waitUntil pattern to
 * survive past the response on Vercel's serverless runtime, so a
 * fire-and-forget write here risks being silently killed mid-flight).
 *
 * Supabase's `.insert()` resolves with `{ error }` on a DB-level failure
 * (RLS, schema, constraint) rather than throwing, so both the returned
 * error and a thrown exception are reported the same way (real gap found
 * 2026-08-20, automated PR review -- this was duplicated ad hoc in two
 * call sites before being extracted here).
 *
 * @param componentTag - human-readable source, used as the log/Sentry
 *   message prefix (e.g. 'DubShortLinkAdapter', 'test-auth-bypass').
 * @param operation - stable Sentry `operation` tag for grouping/alerting
 *   (e.g. 'dub-share-audit', 'test-auth-bypass-audit'). Kept separate from
 *   componentTag (real finding 2026-08-20, CodeRabbit) -- a single
 *   overloaded param made it easy to accidentally rename an existing
 *   Sentry tag (breaking dashboards/alerts) while just meaning to update
 *   the log prefix, or vice versa.
 */
export async function logActivityBestEffort(
  category: string,
  detail: Record<string, unknown>,
  componentTag: string,
  operation: string
): Promise<void> {
  try {
    const service = getSupabaseServiceClient();
    const { error: logError } = await service.from('activity_log').insert({ category, detail });
    if (logError) {
      Sentry.captureMessage(`[${componentTag}] activity_log insert returned an error`, {
        level: 'warning',
        tags: { operation },
        extra: { message: logError.message, code: logError.code, category },
      });
      console.warn(`[${componentTag}] activity_log write returned an error:`, logError.message);
    }
  } catch (logErr) {
    console.warn(`[${componentTag}] activity_log write failed:`, logErr instanceof Error ? logErr.message : String(logErr));
  }
}
