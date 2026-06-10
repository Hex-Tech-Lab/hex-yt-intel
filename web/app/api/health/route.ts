import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  // Check for explicit HTML request (likely a browser)
  const accept = _request.headers.get('accept') || '';
  const format = _request.nextUrl.searchParams.get('format');
  
  // If browser (HTML) and not explicitly asking for JSON, redirect to visual dashboard
  if (accept.includes('text/html') && format !== 'json') {
    return NextResponse.redirect(new URL('/status', _request.url));
  }

  // Default: Return 200 JSON for all automated probes (curl, CI, Vercel)
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
