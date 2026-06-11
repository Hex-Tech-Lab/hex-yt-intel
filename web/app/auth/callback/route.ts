import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Validates whether a cross-domain redirect origin is a safe local development
 * or Vercel preview domain.
 */
function isValidRedirectOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    
    // Only allow http (for localhost) or https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    
    const hostname = url.hostname;
    
    // Allow localhost and 127.0.0.1
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }
    
    // Allow Vercel preview and deployment domains
    if (hostname.endsWith('.vercel.app')) {
      return true;
    }
    
    // Allow custom testing subdomains
    if (hostname.endsWith('.getmytestdrive.com')) {
      return true;
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * OAuth callback route handler for Supabase authentication.
 *
 * Processes the authorization code returned by Supabase OAuth providers,
 * exchanges it for a session, and sets secure HTTP-only auth cookies.
 *
 * @param request - Next.js request containing `code` and `next` query parameters
 * @returns Redirect response to the safe `next` path with session cookies set,
 *          or error redirect if code exchange fails
 *
 * Flow:
 * 1. Check for origin_referrer to bounce the authentication back to preview/local domains
 * 2. Extract authorization code from query params
 * 3. Create Supabase client with cookie manager
 * 4. Exchange code for session via Supabase Auth
 * 5. Capture session tokens (workaround for Route Handler cookie transience)
 * 6. Set tokens on response as HTTP-only, Secure, SameSite=Lax cookies
 * 7. Redirect to safe `next` path (or `/` if unsafe)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // If we are on production, bounce the request back to the preview/local origin callback.
  // This allows preview domains to receive the OAuth tokens and set cookies on their own origin.
  const originReferrer = searchParams.get('origin_referrer');
  if (originReferrer) {
    if (isValidRedirectOrigin(originReferrer)) {
      console.log('[callback] Bouncing OAuth callback to origin_referrer', {
        originReferrer,
        url: request.url,
      });
      const redirectUrl = new URL('/auth/callback', originReferrer);
      searchParams.forEach((value, key) => {
        if (key !== 'origin_referrer') {
          redirectUrl.searchParams.set(key, value);
        }
      });
      return NextResponse.redirect(redirectUrl);
    } else {
      console.warn('[callback] Invalid cross-domain origin_referrer rejected', { originReferrer });
    }
  }

  // Catch any Supabase auth error before attempting code exchange.
  // Common codes: bad_oauth_callback, redirect_uri_mismatch, access_denied, server_error
  const errorCode = searchParams.get('error_code');
  const errorDesc = searchParams.get('error_description') ?? searchParams.get('error') ?? 'unknown_error';
  if (errorCode) {
    console.error('[callback] Supabase OAuth error received', { errorCode, errorDesc });
    const response = NextResponse.redirect(
      new URL(`/auth/error?error=${encodeURIComponent(errorDesc)}`, request.url)
    );
    response.cookies.delete('sb-access-token');
    response.cookies.delete('sb-refresh-token');
    return response;
  }

  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/';

  // Validate next is a safe relative path before decoding
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!code) {
    console.error('[callback] No code parameter — OAuth redirect did not include code');
    return NextResponse.redirect(new URL('/auth/error?error=no_code', request.url));
  }

  console.log('[callback] Code exchange starting', {
    hasCode: true,
    origin: request.headers.get('origin') ?? request.nextUrl.origin,
    next,
  });

  try {
    const cookieStore = await cookies();

    // Request-scoped token holder — avoids module-level race condition in warm isolates
    const pendingTokens: Array<{ name: string; value: string; options?: any }> = [];

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            pendingTokens.length = 0;
            for (const c of cookiesToSet) {
              pendingTokens.push({ name: c.name, value: c.value, options: c.options });
            }
          },
        },
      }
    );

    const decodedNext = decodeURIComponent(safeNext);
    const response = NextResponse.redirect(new URL(decodedNext, request.url));

    // Exchange the authorization code for a session
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(new URL(`/auth/error?error=${encodeURIComponent(error.message)}`, request.url));
    }

    if (!data.session) {
      return NextResponse.redirect(new URL('/auth/error?error=no_session', request.url));
    }

    // Apply Supabase SSR session tokens to the redirect response
    console.log('[callback] Exchange succeeded', {
      pendingTokenCount: pendingTokens.length,
      tokenNames: pendingTokens.map(t => t.name),
      redirectTo: decodedNext,
    });
    for (const { name, value, options } of pendingTokens) {
      response.cookies.set(name, value, options as any);
    }

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(new URL(`/auth/error?error=${encodeURIComponent(errorMessage)}`, request.url));
  }
}
