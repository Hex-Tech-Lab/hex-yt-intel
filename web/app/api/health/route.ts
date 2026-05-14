import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  components: {
    database: {
      status: 'ok' | 'error';
      latency?: number;
      error?: string;
    };
    sentry: {
      status: 'ok' | 'error';
      dsn_configured: boolean;
    };
    worker: {
      status: 'ok' | 'error';
      latency?: number;
      error?: string;
    };
  };
  uptime?: number;
  version?: string;
}

const startTime = Date.now();

/**
 * Health check endpoint for monitoring
 * Returns status of critical components
 * Used by uptime monitoring tools and deployment verification
 */
export async function GET(_request: NextRequest): Promise<NextResponse<HealthResponse>> {
  const timestamp = new Date().toISOString();
  const components: HealthResponse['components'] = {
    database: { status: 'ok' },
    sentry: { status: 'ok', dsn_configured: !!process.env.NEXT_PUBLIC_SENTRY_DSN },
    worker: { status: 'ok' },
  };

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  // 1. Check Supabase connection
  try {
    const supabase = getSupabaseClient();

    const dbStartTime = performance.now();
    const { error } = await supabase.from('users').select('count(*)').limit(1);

    components.database.latency = Math.round(performance.now() - dbStartTime);

    if (error) {
      components.database.status = 'error';
      components.database.error = error.message;
      overallStatus = 'degraded';
      console.error('[/api/health] Database error:', error);
    }
  } catch (error) {
    components.database.status = 'error';
    components.database.error = error instanceof Error ? error.message : 'Unknown error';
    overallStatus = 'degraded';
    console.error('[/api/health] Database connection failed:', error);
  }

  // 2. Check Cloudflare Worker
  try {
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL || 'https://yt-intel.hex-tech-lab.workers.dev';
    const testUrl = `${workerUrl}/fetch-metadata?video_id=dQw4w9WgXcQ`; // Test with Rick Roll

    const workerStartTime = performance.now();
    const response = await fetch(testUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    components.worker.latency = Math.round(performance.now() - workerStartTime);

    if (!response.ok) {
      components.worker.status = 'error';
      components.worker.error = `HTTP ${response.status}`;
      overallStatus = 'degraded';
      console.error('[/api/health] Worker error:', response.status);
    }
  } catch (error) {
    components.worker.status = 'error';
    components.worker.error = error instanceof Error ? error.message : 'Unknown error';
    overallStatus = 'degraded';
    console.error('[/api/health] Worker check failed:', error);
  }

  // 3. Check Sentry configuration
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    components.sentry.status = 'error';
    components.sentry.dsn_configured = false;
    // Sentry not configured is degraded, not critical
    if (overallStatus === 'healthy') {
      overallStatus = 'degraded';
    }
  }

  // Create response
  const response: HealthResponse = {
    status: overallStatus,
    timestamp,
    components,
    uptime: Math.round((Date.now() - startTime) / 1000),
    version: process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0',
  };

  // Return appropriate status code
  const statusCode = overallStatus === 'healthy' ? 200 : 200;

  // Log to Sentry if degraded
  if (overallStatus === 'degraded') {
    Sentry.captureMessage('Health check degraded: one or more components down', 'warning');
  }

  return NextResponse.json(response, { status: statusCode });
}
