export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export const runtime = 'edge';

export async function GET() {
  const components = {
    database: { status: 'unknown', latency: 0, error: null as string | null },
    worker: { status: 'unknown', latency: 0, error: null as string | null },
    sentry: { dsn_configured: !!process.env.SENTRY_DSN || !!process.env.NEXT_PUBLIC_SENTRY_DSN }
  };

  let overallStatus = 'healthy';

  // 1. Check Database Connectivity
  try {
    const dbStart = performance.now();
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('users').select('id').limit(1);

    if (error) throw error;

    components.database.status = 'ok';
    components.database.latency = Math.round(performance.now() - dbStart);
  } catch (err) {
    components.database.status = 'error';
    components.database.error = err instanceof Error ? err.message : String(err);
    overallStatus = 'degraded';
  }

  // 2. Check Cloudflare Worker Connectivity
  try {
    const workerStart = performance.now();
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL || 'https://yt-intel.hex-tech-lab.workers.dev';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    await fetch(workerUrl, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);

    components.worker.status = 'ok';
    components.worker.latency = Math.round(performance.now() - workerStart);
  } catch (err) {
    components.worker.status = 'error';
    components.worker.error = err instanceof Error ? err.message : String(err);
    overallStatus = 'degraded';
  }

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    components
  }, {
    status: 200
  });
}
