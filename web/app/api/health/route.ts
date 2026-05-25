import { NextRequest, NextResponse } from 'next/server';

export async function GET(_request: NextRequest) {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Health check passed - routing is functional',
  }, { status: 200 });
}
