import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import * as Sentry from '@sentry/nextjs';

// Timing-safe string comparison without crypto module (Edge Runtime compatible)
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function hasSupabaseAuth(
  request: NextRequest,
  response: NextResponse
): Promise<{ ok: boolean; diag: Record<string, unknown> }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const allCookies = request.cookies.getAll();
  // @supabase/auth-js default storageKey is 'supabase.auth.token'; chunked cookies are
  // 'supabase.auth.token.0', 'supabase.auth.token.1' etc. Legacy ssr versions used 'sb-*'.
  const authCookieNames = allCookies
    .filter(c =>
      c.name.startsWith('supabase.auth') ||
      c.name.startsWith('sb-') ||
      c.name.includes('auth-token')
    )
    .map(c => c.name);

  // Collect all state upfront, emit ONE log after getUser() — prevents MCP truncation
  // Note: @supabase/auth-js@2.x uses STORAGE_KEY='supabase.auth.token', chunked as
  // 'supabase.auth.token.0', 'supabase.auth.token.1' etc — NOT 'sb-*' or 'auth-token'
  const diag: Record<string, unknown> = {
    hasUrl: !!supabaseUrl,
    isDummyUrl: supabaseUrl?.includes('dummy') ?? false,
    authProvider: process.env.AUTH_PROVIDER ?? '(unset)',
    cookieCount: allCookies.length,
    allCookieNames: allCookies.map(c => c.name),
    authCookieNames,
    path: request.nextUrl.pathname,
    method: request.method,
  };

  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      diag.outcome = 'env_missing';
      console.error('[middleware] auth-diag', diag);
      return { ok: false, diag };
    }

    const isPlaceholderCred = (v: string) => v.includes('dummy') || v.includes('ci-build-placeholder');
    if (isPlaceholderCred(supabaseUrl) || isPlaceholderCred(supabaseAnonKey)) {
      diag.outcome = 'placeholder_creds';
      console.error('[middleware] auth-diag', diag);
      return { ok: false, diag };
    }

    const client = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        // Map to plain objects as required by @supabase/ssr getAll contract
        getAll: () => request.cookies.getAll().map(c => ({ name: c.name, value: c.value })),
        // Write refreshed tokens to response only — official pattern per @supabase/ssr docs
        setAll: (cookiesToSet) => {
          // Prevent CDN caching of token refresh responses to avoid stale auth state
          response.headers.set('Cache-Control', 'no-store, must-revalidate, private');
          response.headers.set('Pragma', 'no-cache');

          cookiesToSet.forEach(({ name, value, options }) => {
            // Spread Supabase's cookie options as-is (official @supabase/ssr pattern).
            // Do NOT force httpOnly/secure/sameSite: Supabase's auth token cookies are
            // intentionally browser-readable so the client SDK can hydrate the session.
            // Forcing httpOnly:true on a refresh made the browser lose its own session
            // after a reload (e.g. switching to Desktop Site) → sign-in redirect loop.
            response.cookies.set(name, value, { ...options, path: options?.path ?? '/' });
          });
        },
      },
    });

    // Bearer token fallback: cryptographically verify the token via Supabase
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      
      const { data: { user: bearerUser }, error: bearerError } = await client.auth.getUser(token);
      if (bearerError || !bearerUser) {
        diag.outcome = 'bearer_invalid';
        diag.supabaseError = bearerError?.message ?? null;
        // Previously silent -- a rejected Bearer token is a machine/API
        // caller with a genuinely bad credential (expired, forged, wrong
        // env), not routine anonymous browser traffic. console.warn only
        // here (not Sentry.captureMessage): the caller (middleware()) already
        // reports to Sentry for any request that had a real credential
        // (hadCredential branch below), so a second report here would double
        // up. This keeps the failure visible in logs without duplicate noise.
        console.warn('[middleware] auth-diag bearer_invalid', diag);
        return { ok: false, diag };
      }
      return { ok: true, diag };
    }

    const { data: { user }, error } = await client.auth.getUser();
    diag.outcome = user ? 'authenticated' : 'rejected';
    diag.supabaseError = error?.message ?? null;
    return { ok: !!user, diag };
  } catch (err) {
    diag.outcome = 'threw';
    diag.error = String(err);
    console.error('[middleware] auth-diag', diag);
    return { ok: false, diag };
  }
}

// Public allowlist. THIS IS THE ONLY WAY A ROUTE UNDER THE MATCHER SKIPS AUTH.
// The gate below is fail-CLOSED: anything not listed here (and not a dev bypass)
// requires a valid Supabase session. When adding a new endpoint whose legitimate
// caller has NO user session cookie — an external webhook, a server-to-server
// (S2S) call, or a pre-auth redirect — add it here explicitly; otherwise leave
// it out and it is protected by default.
//
// Extracted from middleware() to a module-level helper (2026-09-24): the
// chapter-persist exemption added one more branch to an already-threshold
// function, tripping CodeFactor's "Complex Method" + DeepSource JS-R1005.
// Behavior-preserving move; middleware.test.ts pins every branch shape.
const publicRoutes = [
    '/auth/callback',      // Supabase OAuth callback (page, outside matcher — defensive)
    '/api/auth/signin',    // Legacy redirect to /auth/signin (no session by definition)
    '/api/stripe',         // Stripe webhooks (signature-verified)
    '/api/billing/webhook', // Paddle billing webhook (signature-verified, external)
    '/api/webhooks',       // Generic webhooks (QStash/validation — signature/secret gated)
    '/api/health',         // Health check endpoint
    '/api/metadata',       // Public video metadata endpoint
    '/api/transcript-proxy', // Transcript proxy (diagnostic bypass for routing validation)
    // Waitlist signup: anonymous landing-page visitors have no session by
    // definition. Live-caught 2026-08-14 -- this was missing since the
    // route shipped (PR #231), so every real signup 401'd silently at the
    // middleware gate before ever reaching the route's own rate limiting.
    '/api/waitlist',
    // S2S persist: the Cloudflare Worker posts to these from ctx.waitUntil with NO
    // cookies. They are gated by an HMAC content signature inside the handler, not
    // by session auth — so they must bypass the cookie-based middleware gate. The
    // handlers themselves own error-state handling and retry/backoff.
    '/api/analyses/persist',
    '/api/chat/persist',
    // Admin logs snapshot: legitimate caller can be a machine/script with no
    // browser session (the orchestrator polling its own logs). Gated by an
    // HMAC signature (X-Snapshot-Sig/X-Snapshot-Exp) OR an admin session
    // inside the handler itself (see verifySnapshotHmac in
    // app/api/admin/logs/snapshot/route.ts) -- same pattern as the S2S
    // persist routes above, this was just missed when the route was added.
    '/api/admin/logs/snapshot',
    // TestSprite auth-bypass: legitimate caller has NO session by definition
    // (that's the entire point of the route -- it mints one). Real gap found
    // 2026-08-20: this route was launch-blocked in production despite being
    // shipped and gated correctly, because THIS middleware's fail-closed
    // /api/:path* gate ran first and 401'd every request before the route's
    // own env-secret + registry-toggle + timingSafeEqual checks ever ran.
    // Same bug class as the /api/waitlist incident above -- the route's own
    // internal gating (TEST_AUTH_BYPASS_SECRET + testAuthBypass.enabled +
    // hardcoded single target account) is the real security boundary here,
    // not this middleware.
  ];

// A small number of security-sensitive single-purpose routes get EXACT
// path matching only, not the prefix match below -- real finding
// 2026-08-20 (automated PR review): the general `startsWith(route + '/')`
// rule would let any future child path under these silently inherit the
// exemption (e.g. a hypothetical /api/test-auth/login/whatever) without
// anyone noticing. These routes have no legitimate child paths.
const exactPublicRoutes = ['/api/test-auth/login'];

// skipcq: JS-0067 -- module-scope helpers are idiomatic in a Next.js edge
// middleware module; DeepSource's "wrap in an IIFE" advice is a false
// positive here (same class as the other module-level fns in this file).
function isPublicApiRequest(method: string, pathname: string): boolean {
  if (exactPublicRoutes.includes(pathname)) {
    return true;
  }

  // Segment-boundary match so a public prefix can't unintentionally exempt a
  // sibling route (e.g. '/api/stripe' must NOT exempt '/api/stripe-admin').
  if (publicRoutes.some(route => pathname === route || pathname.startsWith(`${route}/`))) {
    return true;
  }

  // S2S chapters persist (the Cloudflare Worker posts this from ctx.waitUntil
  // with NO cookies; gated by an HMAC content signature with purpose
  // 'chapters' inside the handler itself, same pattern as /api/analyses/persist).
  // Method-scoped to POST only: the sibling GET is a browser-session read
  // (useChapters) and must stay fail-closed. Live-caught 2026-09-24 -- this
  // exemption was missing since the decoupled chapter persist shipped
  // (PR #206, 2026-08-06), so EVERY worker chapter persist 401'd at this
  // gate with {"error":"Unauthorized"} before the route's own HMAC check
  // ever ran (same bug class as /api/waitlist 2026-08-14 and
  // /api/test-auth 2026-08-20, both documented above).
  return method === 'POST' && /^\/api\/videos\/[^/]+\/chapters$/.test(pathname);
}

export async function middleware(request: NextRequest) {
  // CORS Preflight Handling (Fixes 401 on OPTIONS)
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { 
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Hex-Test-Secret',
      },
    });
  }

  const { pathname } = request.nextUrl;

  if (isPublicApiRequest(request.method, pathname)) {
    return NextResponse.next();
  }

  // Development-only test validation bypass — allows E2E test suites to bypass auth
  // Requires DEV_BYPASS_TOKEN environment variable (unset in production for safety)
  const isProduction = process.env.NODE_ENV === 'production';
  const devBypassToken = process.env.DEV_BYPASS_TOKEN;
  const testSecret = request.headers.get('X-Hex-Test-Secret');

  if (!isProduction && devBypassToken && testSecret) {
    try {
      const isValidBypass = timingSafeStringEqual(testSecret, devBypassToken);

      if (isValidBypass) {
        console.info('[middleware] Development bypass credential accepted; skipping auth.');
        return NextResponse.next(); // ← CRITICAL: MUST RETURN EXPLICITLY TO EXIT THE FUNCTION
      }
    } catch {
      // Token comparison failed — treat as unauthorized bypass attempt
      console.warn('[middleware] Invalid bypass credential format');
    }
  }

  // Fail-CLOSED: every route the matcher sees (see `config.matcher` below:
  // /analyses/:path* and /api/:path*) that reached this point is neither public
  // nor a dev bypass, so it requires a valid session. Previously this was an
  // allowlist of protected prefixes with an open fallthrough, which meant any
  // new /api/* endpoint (e.g. /api/admin, /api/billing) shipped unauthenticated
  // by default. Defaulting to protected removes that whole class of bug.

  // Official @supabase/ssr pattern: plain NextResponse.next(), cookies written
  // onto the response only (not back onto request). See supabase/ssr docs.
  const supabaseResponse = NextResponse.next();

  const { ok: isAuthenticated, diag } = await hasSupabaseAuth(request, supabaseResponse);

  if (!isAuthenticated) {
    // Only report to Sentry when a real credential was present but failed
    // validation — that's an auth regression worth investigating. Anonymous,
    // credential-less hits on the (now much larger) fail-closed surface are
    // expected (scanners, logged-out navigation) and would only create noise.
    // A present Bearer credential counts too, so API clients stay observable.
    const hadAuthCookie = Array.isArray(diag.authCookieNames) && (diag.authCookieNames as unknown[]).length > 0;
    const hadCredential = hadAuthCookie || (request.headers.get('authorization')?.startsWith('Bearer ') ?? false);
    if (hadCredential) {
      Sentry.captureMessage('Auth Failure', {
        level: 'warning',
        tags: {
          pathname,
          outcome: String(diag.outcome ?? 'unknown'),
          hadAuthCookie: String(hadAuthCookie),
        },
        extra: {
          ...diag,
          userAgent: request.headers.get('user-agent'),
          secFetchSite: request.headers.get('sec-fetch-site'),
        },
      });
    }

    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const signInUrl = new URL('/auth/signin', request.url);
    // Redirect to dashboard after sign-in, not back to raw page paths
    const callbackTarget = pathname.startsWith('/analyses') ? pathname : '/';
    signInUrl.searchParams.append('callbackUrl', callbackTarget);
    return NextResponse.redirect(signInUrl);
  }

  // Return the supabaseResponse so any refreshed cookies are forwarded to the browser
  return supabaseResponse;
}

export const config = {
  matcher: ['/analyses/:path*', '/api/:path*'],
};
