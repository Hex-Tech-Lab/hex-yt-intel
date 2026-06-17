import { NextResponse } from 'next/server';

/**
 * Legacy Redirect Handler
 * next-auth was removed in favor of Supabase auth. 
 * This handler redirects legacy /api/auth/signin calls to the correct /auth/signin page.
 */
export async function GET() {
  return NextResponse.redirect(new URL('/auth/signin', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'), 307);
}

export async function POST() {
  return GET();
}
