export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/admin/logs/qstash — Admin-only live fetch for Upstash QStash event logs
 * Queries https://qstash.upstash.io/v2/events using QSTASH_TOKEN.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/qstash:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'QSTASH_TOKEN is not configured in environment variables.' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') || '1h';
  const customStart = searchParams.get('start');
  const customEnd = searchParams.get('end');

  let startTimeMs: number;
  const now = Date.now();

  if (range === '30m') {
    startTimeMs = now - 30 * 60 * 1000;
  } else if (range === '1h') {
    startTimeMs = now - 60 * 60 * 1000;
  } else if (range === 'today') {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    startTimeMs = todayStart.getTime();
  } else if (range === 'custom' && customStart) {
    startTimeMs = new Date(customStart).getTime();
  } else {
    startTimeMs = now - 60 * 60 * 1000;
  }

  const endTimeMs = range === 'custom' && customEnd ? new Date(customEnd).getTime() : now;

  try {
    const res = await fetch('https://qstash.upstash.io/v2/events', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upstash QStash API returned ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const rawEvents = Array.isArray(data.events) ? data.events : Array.isArray(data) ? data : [];

    const events = rawEvents.filter((evt: any) => {
      const timeMs = typeof evt.time === 'number' ? evt.time : new Date(evt.time || evt.createdAt || 0).getTime();
      return timeMs >= startTimeMs && timeMs <= endTimeMs;
    });

    const logLines: string[] = events.map((evt: any) => {
      const time = new Date(evt.time || evt.createdAt || Date.now()).toISOString();
      const state = (evt.state || evt.status || 'UNKNOWN').toUpperCase();
      const level = state === 'ERROR' || state === 'FAILED' ? 'ERROR' : 'INFO';
      return `[${time}] [${level}] [qstash:${state}] msgId=${evt.messageId || evt.id} url="${evt.url || ''}" topic="${evt.topicName || ''}" retries=${evt.retryCount ?? 0}`;
    });

    const content = logLines.length > 0
      ? logLines.join('\n')
      : `[${new Date().toISOString()}] [INFO] No QStash events recorded in the selected window.`;

    return NextResponse.json({
      range,
      startTime: new Date(startTimeMs).toISOString(),
      endTime: new Date(endTimeMs).toISOString(),
      totalEntries: logLines.length,
      logs: content,
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_qstash_logs' } });
    return NextResponse.json({ error: `Failed to fetch QStash logs: ${message}` }, { status: 500 });
  }
}
