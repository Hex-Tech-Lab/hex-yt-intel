export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/admin/logs/vercel — Admin-only live fetch for Vercel deployment logs
 * Queries Vercel REST API when VERCEL_TOKEN and VERCEL_PROJECT_ID are present.
 */
import { computeTimeWindow } from '@/lib/utils/time-range';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/vercel:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (!token || !projectId) {
    return NextResponse.json(
      {
        error: 'VERCEL_TOKEN or VERCEL_PROJECT_ID not configured in Vercel environment variables.',
        missingEnvVars: ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID'].filter(k => !process.env[k]),
      },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') || '100';
  const { startTimeMs, endTimeMs } = computeTimeWindow(searchParams);

  try {
    const res = await fetch(`https://api.vercel.com/v2/events?projectId=${projectId}&limit=${limit}&since=${startTimeMs}&until=${endTimeMs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Vercel API returned status ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const events = Array.isArray(data.events) ? data.events : Array.isArray(data) ? data : [];

    const filteredEvents = events.filter((e: any) => {
      const ts = new Date(e.created || e.timestamp || e.date || Date.now()).getTime();
      return ts >= startTimeMs && ts <= endTimeMs;
    });

    const logLines = filteredEvents.map((e: any) => {
      const time = new Date(e.created || e.timestamp || Date.now()).toISOString();
      const level = e.level || (e.text?.includes('Error') ? 'ERROR' : 'INFO');
      return `[${time}] [${level}] [vercel:${e.type || 'runtime'}] ${e.text || e.message || JSON.stringify(e)}`;
    });

    return NextResponse.json({
      totalEntries: logLines.length,
      logs: logLines.join('\n') || `[${new Date().toISOString()}] [INFO] No Vercel events found in selected time range.`,
      events: filteredEvents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_vercel_logs' } });
    return NextResponse.json({ error: `Failed to fetch Vercel logs: ${message}` }, { status: 500 });
  }
}
