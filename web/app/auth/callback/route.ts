import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';

export function getSafeRedirectPath(nextValue: string | null, fallback = '/dashboard') {
  if (!nextValue) return fallback;

  let decodedNext: string;
  try {
    decodedNext = decodeURIComponent(nextValue);
  } catch {
    return fallback;
  }

  if (
    !decodedNext.startsWith('/') ||
    decodedNext.startsWith('//') ||
    decodedNext.includes('://')
  ) {
    return fallback;
  }

  return decodedNext;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const safeNext = getSafeRedirectPath(searchParams.get('next'), '/atlas');

  if (!code) {
    return NextResponse.redirect(new URL('/auth/error?error=no_code', request.url));
  }

  const cookieStore = await cookies();
  const response = NextResponse.redirect(new URL(safeNext, request.url));

  const supabase = createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  let sessionError = null;
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    sessionError = error;
  } catch (err: any) {
    sessionError = err;
  }

  if (sessionError) {
    return NextResponse.redirect(
      new URL(`/auth/error?error=${encodeURIComponent(sessionError.message || 'Authentication failed')}`, request.url)
    );
  }

  return response;
}
