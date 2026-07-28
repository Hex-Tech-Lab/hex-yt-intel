export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { computeTimeWindow } from '@/lib/utils/time-range';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/admin/logs/cloudflare — Admin-only live fetch for Cloudflare Worker execution logs
 * Queries Cloudflare GraphQL Analytics API (workersInvocationsAdaptive) using CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/cloudflare:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !accountId) {
    return NextResponse.json(
      {
        error: 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not configured in Vercel environment variables.',
        missingEnvVars: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter(k => !process.env[k]),
      },
      { status: 503 }
    );
  }

  const query = `
    query GetWorkerLogs($accountTag: string!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          workersInvocationsAdaptive(limit: 50, orderBy: [datetime_DESC]) {
            dimensions {
              scriptName
              status
              datetime
            }
            quantiles {
              cpuTimeP50
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { accountTag: accountId } }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Cloudflare GraphQL API returned ${res.status}: ${errText}`);
    }

    const json = await res.json();
    const rawInvocations = json?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
    const { startTimeMs, endTimeMs } = computeTimeWindow(new URL(request.url).searchParams);
    const invocations = rawInvocations.filter((inv: any) => {
      const ts = new Date(inv.dimensions?.datetime || 0).getTime();
      return ts >= startTimeMs && ts <= endTimeMs;
    });

    const logLines = invocations.map((inv: any) => {
      const dims = inv.dimensions || {};
      const time = dims.datetime || new Date().toISOString();
      const status = dims.status || 'unknown';
      const level = status === 'success' || status === 'ok' ? 'INFO' : 'ERROR';
      return `[${time}] [${level}] [cf-worker:${dims.scriptName || 'yt-intel'}] status=${status} p50CpuTime=${inv.quantiles?.cpuTimeP50 ?? 0}ms`;
    });

    return NextResponse.json({
      totalEntries: logLines.length,
      logs: logLines.join('\n') || `[${new Date().toISOString()}] [INFO] No Cloudflare worker invocations returned.`,
      invocations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_cloudflare_logs' } });
    return NextResponse.json({ error: `Failed to fetch Cloudflare logs: ${message}` }, { status: 500 });
  }
}
