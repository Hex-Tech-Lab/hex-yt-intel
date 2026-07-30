import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
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
    // No `code` param at all -- either a bot/scanner probing this endpoint
    // directly (matches the 2026-07-29 unexplained-login investigation's
    // concern about automated traffic finding the app pre-launch) or a
    // malformed/manually-typed URL. Previously had zero telemetry, unlike
    // the below "code present but exchange failed" branch.
    Sentry.captureMessage('auth-callback: no code param', {
      level: 'info',
      tags: { operation: 'auth-callback' },
      extra: { userAgent: request.headers.get('user-agent') },
    });
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
          // Same pattern as middleware.ts: spread Supabase's cookie options
          // as-is (it already sets sameSite=lax / secure / browser-readable
          // correctly) and only guarantee a path. Do NOT force httpOnly or
          // other attributes — forcing them is what caused the Desktop/Mobile
          // mode-switch sign-in loop.
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, { ...options, path: options?.path ?? '/' });
          });
        },
      },
    }
  );

  let sessionError = null;
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    sessionError = error;
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { operation: 'auth-callback' } });
    sessionError = err;
  }

  if (sessionError) {
    // The exchange can fail on a stale/replayed authorization code — e.g. when a
    // Desktop/Mobile-site reload re-fires this callback while the user is already
    // signed in. Before dead-ending on the error page, check whether a valid
    // session already exists; if so, just send them into the app.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        return response;
      }
    } catch (recoverErr) {
      // No existing session to recover — fall through to the error page below.
      console.warn('[auth-callback] session recovery check failed', recoverErr instanceof Error ? recoverErr.message : String(recoverErr));
    }

    const message = sessionError instanceof Error ? sessionError.message : 'Authentication failed';
    Sentry.captureMessage('auth-callback: code exchange failed with no existing session', {
      level: 'warning',
      tags: { operation: 'auth-callback' },
      extra: { message, userAgent: request.headers.get('user-agent') },
    });
    return NextResponse.redirect(
      new URL(`/auth/error?error=${encodeURIComponent(message)}`, request.url)
    );
  }

  return response;
}
