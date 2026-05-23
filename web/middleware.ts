import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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
): Promise<boolean> {
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
      return false;
    }

    const isPlaceholderCred = (v: string) => v.includes('dummy') || v.includes('ci-build-placeholder');
    if (isPlaceholderCred(supabaseUrl) || isPlaceholderCred(supabaseAnonKey)) {
      diag.outcome = 'placeholder_creds';
      console.error('[middleware] auth-diag', diag);
      return false;
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
            response.cookies.set(name, value, {
              ...options,
              path: options?.path ?? '/',
              secure: options?.secure ?? true,
              httpOnly: options?.httpOnly ?? true,
              sameSite: options?.sameSite ?? 'lax',
            });
          });
        },
      },
    });

    // Bearer token fallback: cryptographically verify the token via Supabase
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      
      // CI/Test Bypass: If token starts with test-token- or user-, accept it immediately
      if ((token.startsWith('test-token-') || token.startsWith('user-')) && process.env.NODE_ENV !== 'production') {
        diag.outcome = 'bearer_test_bypass';
        console.log('[middleware] auth-diag', diag);
        return true;
      }

      const { data: { user: bearerUser }, error: bearerError } = await client.auth.getUser(token);
      if (bearerError || !bearerUser) {
        diag.outcome = 'bearer_invalid';
        diag.bearerError = bearerError?.message ?? null;
        console.error('[middleware] auth-diag', diag);
        return false;
      }
      diag.outcome = 'bearer_accepted';
      console.log('[middleware] auth-diag', diag);
      return true;
    }

    const { data: { user }, error } = await client.auth.getUser();
    diag.outcome = user ? 'authenticated' : 'rejected';
    diag.supabaseError = error?.message ?? null;
    console.log('[middleware] auth-diag', diag);
    return !!user;
  } catch (err) {
    diag.outcome = 'threw';
    diag.error = String(err);
    console.error('[middleware] auth-diag', diag);
    return false;
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

  const isAuthenticated = await hasSupabaseAuth(request, supabaseResponse);

  if (!isAuthenticated) {
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
