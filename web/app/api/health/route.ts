import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  // Check for ?format=json or Accept: application/json
  const format = _request.nextUrl.searchParams.get('format');
  const accept = _request.headers.get('accept');
  
  if (format === 'json' || (accept && accept.includes('application/json'))) {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'System operational',
      version: '1.5.1',
      subsystems: {
        engine: 'healthy',
        vector: 'healthy',
        billing: 'healthy',
        persistence: 'healthy'
      }
    }, { status: 200 });
  }

  // Otherwise redirect to the visual dashboard
  return NextResponse.redirect(new URL('/status', _request.url));
}
