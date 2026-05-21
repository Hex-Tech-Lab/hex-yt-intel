export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function GET() {
  throw new Error("Sentry Test: Manual verification of error reporting pipeline.");
  return NextResponse.json({ status: 'ok' });
}
