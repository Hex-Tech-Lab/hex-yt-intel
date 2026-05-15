import { createServerClient, type CookieOptions } from '@supabase/ssr';
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
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options as CookieOptions)
              );
            } catch {
              // Can be safely ignored during middleware/API route execution
            }
          },
        },
      }
    );

    // Exchange the authorization code for a session
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(new URL(`/auth/error?error=${encodeURIComponent(error.message)}`, request.url));
    }

    // Decode the next parameter and ensure it's safe
    const decodedNext = decodeURIComponent(next);
    const safeNext = decodedNext.startsWith('/') ? decodedNext : '/';

    return NextResponse.redirect(new URL(safeNext, request.url));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(new URL(`/auth/error?error=${encodeURIComponent(errorMessage)}`, request.url));
  }
}
