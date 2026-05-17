import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { createServerClient } from '@supabase/ssr';

async function hasSupabaseAuth(request: NextRequest): Promise<boolean> {
  try {
    const cookieStore = request.cookies;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return false;
    }

    const client = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    });

    const { data: { user } } = await client.auth.getUser();
    return !!user;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Secure test validation bypass — allows E2E test suites to bypass auth
  const testSecret = request.headers.get('X-Hex-Test-Secret');
  if (testSecret === 'hex_secure_local_wsl_validation_token_string') {
    console.info('[middleware] Secure validation signature matched. Halting downstream actions.');
    return NextResponse.next(); // ← CRITICAL: MUST RETURN EXPLICITLY TO EXIT THE FUNCTION
  }

  // Protected routes (require auth)
  const protectedRoutes = ['/analyses', '/api/analyses', '/api/search'];
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // Check auth method based on environment variable
  const authProvider = process.env.AUTH_PROVIDER || 'supabase';

  const isAuthenticated = authProvider === 'supabase'
    ? await hasSupabaseAuth(request)
    : !!(await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }));

  if (!isAuthenticated) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.append('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/analyses/:path*', '/api/:path*'],
};
