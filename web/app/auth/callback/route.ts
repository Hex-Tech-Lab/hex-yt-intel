import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

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
 * 1. Extract authorization code from query params
 * 2. Create Supabase client with cookie manager
 * 3. Exchange code for session via Supabase Auth
 * 4. Capture session tokens (workaround for Route Handler cookie transience)
 * 5. Set tokens on response as HTTP-only, Secure, SameSite=Lax cookies
 * 6. Redirect to safe `next` path (or `/` if unsafe)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Short-circuit bad OAuth callback states (416 prevention)
  if (searchParams.get('error_code') === 'bad_oauth_callback') {
    const response = NextResponse.redirect(new URL('/', request.url));
    response.cookies.delete('sb-access-token');
    response.cookies.delete('sb-refresh-token');
    return response;
  }

  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/';

  // Validate next is a safe relative path before decoding
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!code) {
    return NextResponse.redirect(new URL('/auth/error?error=no_code', request.url));
  }

  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            sessionTokens.current = cookiesToSet.map(c => ({
              name: c.name,
              value: c.value,
              options: c.options,
            }));
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

    // Apply Supabase SSR session tokens
    const tokens = sessionTokens.current;
    if (tokens) {
      for (const { name, value, options } of tokens) {
        response.cookies.set(name, value, options as any);
      }
    }

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(new URL(`/auth/error?error=${encodeURIComponent(errorMessage)}`, request.url));
  }
}

// Per-request holder for session tokens captured during exchangeCodeForSession.
// Must be module-scoped so the closure over sessionTokens survives the
// exchangeCodeForSession async call into the redirect response block below.
const sessionTokens: {
  current: Array<{ name: string; value: string; options?: any }> | null;
} = { current: null };
