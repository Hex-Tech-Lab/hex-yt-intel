export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/admin/logs/supabase — Admin-only live fetch for Supabase Management API logs
 * Queries https://api.supabase.com/v1/projects/{ref}/logs when SUPABASE_ACCESS_TOKEN is present.
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/supabase:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/(.*?)\.supabase\.co/)?.[1];

  if (!token || !projectRef) {
    return NextResponse.json(
      {
        error: 'SUPABASE_ACCESS_TOKEN is missing or project reference could not be parsed.',
        missingEnvVars: ['SUPABASE_ACCESS_TOKEN'].filter(k => !process.env[k]),
      },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/logs?type=postgres`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Supabase Management API returned status ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const resultList = Array.isArray(data.result) ? data.result : [];

    const logLines = resultList.map((e: any) => {
      const time = new Date(e.timestamp ? e.timestamp / 1000 : Date.now()).toISOString();
      const level = e.event_message?.includes('ERROR') ? 'ERROR' : 'INFO';
      return `[${time}] [${level}] [supabase:postgres] ${e.event_message || JSON.stringify(e)}`;
    });

    return NextResponse.json({
      totalEntries: logLines.length,
      logs: logLines.join('\n') || `[${new Date().toISOString()}] [INFO] No Supabase log entries returned.`,
      resultList,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_supabase_logs' } });
    return NextResponse.json({ error: `Failed to fetch Supabase logs: ${message}` }, { status: 500 });
  }
}
