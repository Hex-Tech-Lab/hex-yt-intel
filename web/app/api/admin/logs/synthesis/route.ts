export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/admin/logs/synthesis — Admin-only live fetch for in-app synthesis logs
 * Queries public.analyses and public.comment_sample_runs by time range.
 */
export async function GET(request: NextRequest) {
  const adminResult = await requireAdmin('admin/logs/synthesis:GET');
  if ('error' in adminResult) {
    return adminResult.error;
  }

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') || '1h';
  const customStart = searchParams.get('start');
  const customEnd = searchParams.get('end');

  let startTimeIso: string;
  const now = new Date();

  if (range === '30m') {
    startTimeIso = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  } else if (range === '1h') {
    startTimeIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  } else if (range === 'today') {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    startTimeIso = todayStart.toISOString();
  } else if (range === 'custom' && customStart) {
    startTimeIso = new Date(customStart).toISOString();
  } else {
    startTimeIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  }

  const endTimeIso = range === 'custom' && customEnd ? new Date(customEnd).toISOString() : now.toISOString();

  try {
    const service = getSupabaseServiceClient();

    const { data: analyses, error: analysesError } = await service
      .from('analyses')
      .select('id, video_id, title, billing_status, model_used, validation_passed, created_at, updated_at')
      .gte('updated_at', startTimeIso)
      .lte('updated_at', endTimeIso)
      .order('updated_at', { ascending: true })
      .limit(200);

    if (analysesError) throw analysesError;

    const { data: sampleRuns } = await service
      .from('comment_sample_runs')
      .select('id, analysis_id, tier, total_comment_count, sampled_count, status, created_at, completed_at')
      .gte('created_at', startTimeIso)
      .lte('created_at', endTimeIso)
      .order('created_at', { ascending: true })
      .limit(100);

    const logLines: string[] = [];

    (analyses || []).forEach(row => {
      const statusTag = (row.billing_status || 'unknown').toUpperCase();
      const level = row.billing_status === 'failed' ? 'ERROR' : row.billing_status === 'processing' ? 'WARN' : 'INFO';
      logLines.push(`[${row.updated_at}] [${level}] [synthesis:${statusTag}] analysisId=${row.id} videoId=${row.video_id} model=${row.model_used || 'edge-stream'} valid=${row.validation_passed} title="${row.title}"`);
    });

    (sampleRuns || []).forEach(run => {
      const statusTag = (run.status || 'unknown').toUpperCase();
      const level = run.status === 'failed' ? 'ERROR' : 'INFO';
      logLines.push(`[${run.created_at}] [${level}] [comment-sample-run:${statusTag}] runId=${run.id} analysisId=${run.analysis_id} tier=${run.tier} totalCount=${run.total_comment_count} sampledCount=${run.sampled_count || 0}`);
    });

    logLines.sort((a, b) => a.localeCompare(b));

    const content = logLines.length > 0 
      ? logLines.join('\n') 
      : `[${new Date().toISOString()}] [INFO] No synthesis activity recorded between ${startTimeIso} and ${endTimeIso}.`;

    return NextResponse.json({
      range,
      startTime: startTimeIso,
      endTime: endTimeIso,
      totalEntries: logLines.length,
      logs: content,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_synthesis_logs' } });
    return NextResponse.json({ error: `Failed to fetch synthesis logs: ${message}` }, { status: 500 });
  }
}
