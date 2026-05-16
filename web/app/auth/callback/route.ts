import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/';

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
            // Route Handlers: cookies() from next/headers is NOT a persistent
            // store.  The Supabase SSR setAll callback would silently discard
            // tokens here.  Instead we capture them in sessionTokens and apply
            // them explicitly to the NextResponse below.
            sessionTokens.current = cookiesToSet.map(c => ({
              name: c.name,
              value: c.value,
              options: c.options,
            }));
          },
        },
      }
    );

    // Decode the next parameter and ensure it's safe
    const decodedNext = decodeURIComponent(next);
    const safeNext = decodedNext.startsWith('/') ? decodedNext : '/';
    const response = NextResponse.redirect(new URL(safeNext, request.url));

    // Exchange the authorization code for a session
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(new URL(`/auth/error?error=${encodeURIComponent(error.message)}`, request.url));
    }

    if (!data.session) {
      return NextResponse.redirect(new URL('/auth/error?error=no_session', request.url));
    }

    // Apply Supabase SSR session tokens captured by setAll to the response.
    // This is the correct way to propagate auth cookies from a Route Handler
    // where next/headers cookies() is transient.
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
