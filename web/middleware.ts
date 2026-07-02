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

  // Public allowlist. THIS IS THE ONLY WAY A ROUTE UNDER THE MATCHER SKIPS AUTH.
  // The gate below is fail-CLOSED: anything not listed here (and not a dev bypass)
  // requires a valid Supabase session. When adding a new endpoint whose legitimate
  // caller has NO user session cookie — an external webhook, a server-to-server
  // (S2S) call, or a pre-auth redirect — add it here explicitly; otherwise leave
  // it out and it is protected by default.
  const publicRoutes = [
    '/auth/callback',      // Supabase OAuth callback (page, outside matcher — defensive)
    '/api/auth/signin',    // Legacy redirect to /auth/signin (no session by definition)
    '/api/stripe',         // Stripe webhooks (signature-verified)
    '/api/billing/webhook', // Paddle billing webhook (signature-verified, external)
    '/api/webhooks',       // Generic webhooks (QStash/validation — signature/secret gated)
    '/api/health',         // Health check endpoint
    '/api/metadata',       // Public video metadata endpoint
    '/api/transcript-proxy', // Transcript proxy (diagnostic bypass for routing validation)
    // S2S persist: the Cloudflare Worker posts to these from ctx.waitUntil with NO
    // cookies. They are gated by an HMAC content signature inside the handler, not
    // by session auth — so they must bypass the cookie-based middleware gate.
    '/api/analyses/persist',
    '/api/chat/persist',
  ];

  if (publicRoutes.some(route => pathname.startsWith(route))) {
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
        console.info('[middleware] Development bypass token validated. Halting downstream actions.');
        return NextResponse.next(); // ← CRITICAL: MUST RETURN EXPLICITLY TO EXIT THE FUNCTION
      }
    } catch {
      // Token comparison failed — treat as unauthorized bypass attempt
      console.warn('[middleware] Invalid bypass token format');
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
    // Only report to Sentry when a session cookie was actually present but failed
    // validation — that's a real auth regression worth investigating. Anonymous,
    // cookieless hits on the (now much larger) fail-closed surface are expected
    // (scanners, logged-out navigation) and would only create alert noise.
    const hadAuthCookie = Array.isArray(diag.authCookieNames) && (diag.authCookieNames as unknown[]).length > 0;
    if (hadAuthCookie) {
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
