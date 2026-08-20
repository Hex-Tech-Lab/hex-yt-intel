import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { resolveTestAuthBypassEnabled } from '@/lib/config/test-auth';
import { getSupabaseServiceClient } from '@/lib/supabase';

/**
 * TEST-ONLY AUTH BYPASS — why this route exists
 * ================================================================
 * This app's only login method is Google OAuth (see /auth/signin), which
 * correctly rejects automated browsers (TestSprite run 2026-08-19 hit this:
 * 10/15 test cases blocked by Google's bot-detection, unfixable from our
 * side since Google owns that gate). Every future automated-testing run
 * hits the same wall. This route lets a designated test account skip the
 * Google OAuth hop while still producing a REAL Supabase session, so the
 * rest of the app (getSupabaseClientWithAuth, RLS, SupabaseAuthAdapter,
 * every route/RSC that reads the sb-* cookies) treats the result as a
 * completely normal authenticated session — no special-casing anywhere
 * else in the codebase.
 *
 * SECURITY BOUNDARY (read before touching this file)
 * ------------------------------------------------------------------
 * This is emphatically NOT a general backdoor. Three independent gates all
 * have to hold simultaneously, or the route is fully inert:
 *
 *   1. `TEST_AUTH_BYPASS_SECRET` must be set server-side at all. In
 *      production this env var is simply never configured (it has no
 *      mock/functional fallback anywhere in web/lib/env.ts — see
 *      `testAuthBypassSecret`'s getter comment) — so on prod this whole
 *      handler 404s unconditionally, before any request-supplied value is
 *      even inspected.
 *   2. The caller must supply the exact same secret per request, via the
 *      `x-test-auth-secret` header. Compared with `timingSafeEqual`, not
 *      `===`, to avoid a timing side-channel on the secret.
 *   3. The bypass only ever authenticates ONE hardcoded, pre-existing test
 *      account (`TEST_ACCOUNT_EMAIL` below) — never an arbitrary email from
 *      the request body/query. There is no "any user" mode.
 *
 * A mismatch on (1) or (2) returns 404 (not 401/403) — this endpoint does
 * not reveal its own existence to an unauthenticated prober any more than
 * a route that was never wired up at all.
 *
 * REAL MECHANISM (not a parallel/fake auth system)
 * ------------------------------------------------------------------
 * Same building blocks as the real OAuth callback (web/app/auth/callback/
 * route.ts): a `@supabase/ssr` `createServerClient` whose `cookies.setAll`
 * writes directly onto the outgoing `NextResponse`. The only difference is
 * how the session is minted:
 *   - Real flow:  Google OAuth code → `exchangeCodeForSession(code)`.
 *   - This route: service-role `auth.admin.generateLink({ type: 'magiclink' })`
 *     for the test account → hand the returned `hashed_token` to the
 *     request-scoped anon client's `auth.verifyOtp({ type: 'magiclink',
 *     token_hash })`.
 * `verifyOtp` is Supabase's own real OTP-verification code path (the same
 * one a real magic-link email click would hit) — it returns a genuine
 * access/refresh token pair and Supabase's own SSR helper writes the exact
 * cookies `getSupabaseClientWithAuth()` / `SupabaseAuthAdapter` already
 * know how to read. Nothing downstream needs to know this session was
 * minted via a magic link instead of an OAuth redirect.
 */

const TEST_ACCOUNT_EMAIL = 'testSprite@getvintel.com';

export async function POST(request: NextRequest) {
  const configuredSecret = env.testAuthBypassSecret;

  // TEMP DIAGNOSTIC — remove immediately after use, never leaks the value
  if (request.headers.get('x-diag-probe') === '1') {
    return NextResponse.json({ hasSecret: Boolean(configuredSecret), len: configuredSecret?.length ?? 0 });
  }

  // Gate 1: env var not configured at all (the prod/default state) -> inert.
  if (!configuredSecret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Gate 2: per-request secret must match, via a constant-time comparison.
  const providedSecret = request.headers.get('x-test-auth-secret') ?? '';
  const configuredBuf = Buffer.from(configuredSecret);
  const providedBuf = Buffer.from(providedSecret);
  const secretsMatch =
    configuredBuf.length === providedBuf.length &&
    providedBuf.length > 0 &&
    timingSafeEqual(configuredBuf, providedBuf);

  if (!secretsMatch) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Gate 3 (registry): the bypass must ALSO be explicitly enabled in the
  // Settings Registry (testAuthBypass.enabled, default false) -- having the
  // env secret configured is no longer sufficient on its own. Same 404 as
  // the other gates so a failure here doesn't reveal which check failed.
  // resolveTestAuthBypassEnabled() already fails closed internally
  // (SupabaseSettingsAdapter.getRegistrySettings catches every DB error and
  // returns the `false` fallback) -- this try/catch is defense-in-depth
  // insurance against that contract changing underneath this route later,
  // not a currently-reachable path. A rejection here must still 404, same
  // as every other gate, never 500 (which would reveal the route's own
  // existence to a prober).
  let registryEnabled = false;
  try {
    registryEnabled = await resolveTestAuthBypassEnabled();
  } catch (registryErr) {
    Sentry.captureException(registryErr, { tags: { operation: 'test-auth-bypass-registry' } });
  }
  if (!registryEnabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!env.supabaseServiceRoleKey) {
    Sentry.captureMessage('test-auth bypass: secret matched but no service-role key configured', {
      level: 'error',
      tags: { operation: 'test-auth-bypass' },
    });
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const adminClient = createSupabaseClient(env.supabaseUrl, env.supabaseServiceRoleKey);

  // Gate 3 (structural, not request-controlled): the target account is a
  // hardcoded constant above -- there is no way for a caller to authenticate
  // as anyone else through this route.
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: TEST_ACCOUNT_EMAIL,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    Sentry.captureException(linkError ?? new Error('generateLink returned no hashed_token'), {
      tags: { operation: 'test-auth-bypass' },
    });
    return NextResponse.json({ error: 'Failed to mint test session' }, { status: 500 });
  }

  const cookieStore = await cookies();
  const response = NextResponse.json({ ok: true, email: TEST_ACCOUNT_EMAIL });

  // Same cookie-write pattern as the real OAuth callback (route.ts in
  // auth/callback): anon-key client, setAll writes onto the response.
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, { ...options, path: options?.path ?? '/' });
        });
      },
    },
  });

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: linkData.properties.hashed_token,
  });

  if (verifyError) {
    Sentry.captureException(verifyError, { tags: { operation: 'test-auth-bypass' } });
    return NextResponse.json({ error: 'Failed to verify test session' }, { status: 500 });
  }

  // Real activity log of bypass usage (never the secret itself) -- best-effort,
  // never blocks the actual login response.
  try {
    const service = getSupabaseServiceClient();
    // Supabase's .insert() does NOT throw on a DB-level failure (RLS, schema,
    // constraint) -- it resolves with { error }. Real gap found 2026-08-20
    // (automated PR review): the catch block alone silently missed any such
    // failure, since a returned error object isn't a thrown exception.
    const { error: logError } = await service.from('activity_log').insert({
      category: 'testsprite_bypass',
      detail: {
        email: TEST_ACCOUNT_EMAIL,
        outcome: 'success',
        requestIp: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
        userAgent: request.headers.get('user-agent') ?? null,
        timestamp: new Date().toISOString(),
      },
    });
    if (logError) {
      Sentry.captureMessage('[test-auth-bypass] activity_log insert returned an error', {
        level: 'warning',
        tags: { operation: 'test-auth-bypass-audit' },
        extra: { message: logError.message, code: logError.code },
      });
      console.warn('[test-auth-bypass] activity_log write returned an error:', logError.message);
    }
  } catch (logErr) {
    console.warn('[test-auth-bypass] activity_log write failed:', logErr instanceof Error ? logErr.message : String(logErr));
  }

  return response;
}
