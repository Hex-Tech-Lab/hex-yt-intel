import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export function getSafeRedirectPath(nextValue: string | null, fallback = '/atlas') {
  if (!nextValue) return fallback;

  let decodedNext: string;
  try {
    decodedNext = decodeURIComponent(nextValue);
  } catch {
    return fallback;
  }

  // Internal-only redirect rules:
  // - must start with a single "/"
  // - must not start with "//" (protocol-relative)
  // - must not contain "://"
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
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL(`/auth/error?error=${encodeURIComponent(error.message)}`, request.url));
  }

  return response;
}
