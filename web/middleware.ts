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

  // Explicitly allow public API routes to pass through without auth checks.
  // This includes auth callbacks, webhooks, public health checks, and metadata requests.
  const publicRoutes = [
    '/auth/callback',      // Supabase OAuth callback
    '/api/stripe',         // Stripe webhooks
    '/api/webhooks',       // Generic webhooks
    '/api/health',         // Health check endpoint
    '/api/metadata',       // Public video metadata endpoint
    '/api/transcript-proxy', // Transcript proxy (diagnostic bypass for routing validation)
    // S2S persist: the Cloudflare Worker posts here from ctx.waitUntil with NO
    // cookies. It is gated by an HMAC content signature inside the handler, not
    // by session auth — so it must bypass the cookie-based middleware gate.
    // Without this it matches the '/api/analyses' protected prefix and the
    // worker's call dies with a 401 ("Auth session missing!").
    '/api/analyses/persist',
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

  // Protected routes (require auth)
  const protectedRoutes = ['/analyses', '/api/analyses', '/api/search'];
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // Official @supabase/ssr pattern: plain NextResponse.next(), cookies written
  // onto the response only (not back onto request). See supabase/ssr docs.
  const supabaseResponse = NextResponse.next();

  const { ok: isAuthenticated, diag } = await hasSupabaseAuth(request, supabaseResponse);

  if (!isAuthenticated) {
    Sentry.captureMessage('Auth Failure', {
      level: 'warning',
      tags: {
        pathname,
        outcome: String(diag.outcome ?? 'unknown'),
        hadAuthCookie: String(Array.isArray(diag.authCookieNames) && (diag.authCookieNames as unknown[]).length > 0),
      },
      extra: {
        ...diag,
        userAgent: request.headers.get('user-agent'),
        secFetchSite: request.headers.get('sec-fetch-site'),
      },
    });

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
