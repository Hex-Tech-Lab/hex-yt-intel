import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyResourceOwnership } from '@/lib/services/ownership';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function safeReconstructMarkdown(analysis: any): string {
  if (analysis.analysis_markdown) return analysis.analysis_markdown;
  if (analysis.analysis_payload) return reconstructMarkdown(analysis.analysis_payload);
  return '';
}

/**
 * GET /api/analyses/[id]/status — Lightweight status check for in-flight or completed analyses.
 * Returns streaming status, completed dimension indices, and updated markdown.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: analysisId } = await params;

  try {
    const { data: analysis, error } = await verifyResourceOwnership<any>(
      analysisId,
      'analyses',
      'id, user_id, video_id, title, channel_title, model_used, analysis_markdown, analysis_payload, validation_report, created_at, updated_at, billing_status'
    );

    if (error === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error === 'InternalError') {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (error === 'NotFound' || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const report = analysis.validation_report || {};
    const validationStatus = report.validation_status || report.status || 'processing';

    let status: 'complete' | 'processing' | 'error' | 'partial' = 'processing';
    if (validationStatus === 'done' || analysis.billing_status === 'completed') {
      status = 'complete';
    } else if (validationStatus === 'error' || validationStatus === 'failed' || analysis.billing_status === 'failed') {
      status = 'error';
    } else if (validationStatus === 'partial') {
      status = 'partial';
    }

    const reconstructedMarkdown = safeReconstructMarkdown(analysis);
    const parsedDimensions = parseToUCISDimensions(reconstructedMarkdown || '');
    const completedDimensions = Object.keys(parsedDimensions).map(Number);

    // Staleness clock must be updated_at, not created_at: the worker touches
    // updated_at on every incremental dimension write, so a genuinely
    // in-flight analysis keeps resetting this clock. created_at never
    // changes, so any analysis older than 120s with zero dimensions
    // persisted yet (persist writes analysis_markdown only at the very end)
    // was always misreported as stale/dead, even mid-stream on a healthy
    // worker. Falls back to created_at only when updated_at is absent.
    const staleClockMs = new Date(analysis.updated_at || analysis.created_at).getTime();
    const isStale = status === 'processing' && Date.now() - staleClockMs >= 120_000;
    if (isStale && completedDimensions.length === 0) {
      status = 'error';
    }

    return NextResponse.json({
      id: analysis.id,
      videoId: analysis.video_id,
      title: analysis.title || 'Untitled',
      status,
      billingStatus: analysis.billing_status || 'processing',
      completedDimensions,
      completedCount: completedDimensions.length,
      analysisMarkdown: reconstructedMarkdown,
      updatedAt: analysis.updated_at || analysis.created_at,
    });
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { operation: 'get-analysis-status' }, extra: { analysisId } });
    console.error('[getAnalysisStatus]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
