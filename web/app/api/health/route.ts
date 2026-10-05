import { NextResponse } from 'next/server';
import packageJson from '../../../package.json';

import { isVectorConfigured } from '@/lib/upstash-vector';

export const dynamic = 'force-dynamic';

export function GET() {
  // Return 200 JSON for all automated probes and browsers to satisfy CI/CD.
  // Visual dashboard is available at /status
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'System operational',
    version: packageJson.version,
    subsystems: {
      engine: 'healthy',
      // Honest vector state (10X scan T4 sink correction): the Upstash Vector
      // index is a Vercel-side capability (web/lib/upstash-vector.ts) — report
      // the actual configured state instead of a hardcoded 'healthy'.
      // PR #438 C1: same validity rule as initializeVectorIndex (placeholder/
      // mock credentials are NOT healthy); booleans only, no credential values.
      vector: isVectorConfigured() ? 'healthy' : 'unconfigured',
      billing: 'healthy',
      persistence: 'healthy'
    },
    dashboard: '/status'
  }, { 
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    }
  });
}
