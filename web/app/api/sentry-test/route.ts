export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse('Not Found', { status: 404 });
  }
  throw new Error("Sentry Test: Manual verification of error reporting pipeline.");
  return NextResponse.json({ status: 'ok' });
}
