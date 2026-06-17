import { NextResponse } from 'next/server';

/**
 * Legacy Redirect Handler
 * next-auth was removed in favor of Supabase auth. 
 * This handler redirects legacy /api/auth/signin calls to the correct /auth/signin page.
 */
export function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: 'Server configuration error: APP_URL not set' },
      { status: 500 }
    );
  }
  return NextResponse.redirect(new URL('/auth/signin', appUrl), 307);
}

export function POST() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: 'Server configuration error: APP_URL not set' },
      { status: 500 }
    );
  }
  return NextResponse.redirect(new URL('/auth/signin', appUrl), 303);
}
