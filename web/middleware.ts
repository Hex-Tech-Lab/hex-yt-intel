import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
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
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Diagnostic: surface dummy-key CI leakage or missing Edge Runtime vars
    console.log('[middleware] Env diagnostic', {
      hasUrl: !!supabaseUrl,
      isDummyUrl: supabaseUrl?.includes('dummy') ?? false,
      authProvider: process.env.AUTH_PROVIDER ?? '(unset)',
    });

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[middleware] SUPABASE env vars missing — check Vercel Edge Runtime settings');
      return false;
    }

    const isPlaceholderCred = (v: string) => v.includes('dummy') || v.includes('ci-build-placeholder');
    if (isPlaceholderCred(supabaseUrl) || isPlaceholderCred(supabaseAnonKey)) {
      console.error('[middleware] CI placeholder credentials detected in runtime — Vercel env vars not set for Edge Runtime');
      return false;
    }

    // Bearer token fallback: allow API clients that send Authorization header
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const bearerToken = authHeader.slice(7);
      // Validate JWT structure (3 base64 segments) before trusting it
      const parts = bearerToken.split('.');
      if (parts.length === 3 && parts.every(p => p.length > 0)) {
        console.info('[middleware] Bearer token detected — bypassing cookie auth');
        return true;
      }
      console.warn('[middleware] Malformed Bearer token rejected');
    }

    const allCookies = request.cookies.getAll();
    const hasAuthCookie = allCookies.some(c => c.name.includes('auth-token') || c.name.includes('sb-'));
    if (!hasAuthCookie) {
      console.warn('[middleware] No Supabase auth cookies found in request', {
        cookieNames: allCookies.map(c => c.name),
        path: request.nextUrl.pathname,
      });
    }

    const client = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          // Keep the request cookie jar in sync for downstream reads in this middleware
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // Write refreshed tokens to the response so they reach the browser
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as any)
          );
        },
      },
    });

    const { data: { user }, error } = await client.auth.getUser();
    if (!user) {
      console.error('[middleware] Auth guard rejected', {
        error: error?.message ?? 'no error object',
        cookieCount: allCookies.length,
        authCookieNames: allCookies
          .filter(c => c.name.includes('sb-') || c.name.includes('auth-token'))
          .map(c => c.name),
        path: request.nextUrl.pathname,
        method: request.method,
      });
    }
    return !!user;
  } catch (err) {
    console.error('[middleware] hasSupabaseAuth threw', { error: String(err) });
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
    '/api/auth',           // NextAuth callbacks
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

  // Check auth method based on environment variable
  const authProvider = process.env.AUTH_PROVIDER || 'supabase';

  // Forward the mutated request (with refreshed cookies) to downstream route handlers.
  // Without this, Server Components calling cookies() won't see the updated session.
  const supabaseResponse = NextResponse.next({ request });

  const isAuthenticated = authProvider === 'supabase'
    ? await hasSupabaseAuth(request, supabaseResponse)
    : !!(await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET || "" }));

  if (!isAuthenticated) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.append('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Return the supabaseResponse so any refreshed cookies are forwarded to the browser
  return supabaseResponse;
}

export const config = {
  matcher: ['/analyses/:path*', '/api/:path*'],
};
