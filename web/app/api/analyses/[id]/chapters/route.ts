import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import { verifyResourceOwnership } from '@/lib/services/ownership';
import { SupabaseTranscriptAdapter } from '@/lib/adapters/SupabaseTranscriptAdapter';

/**
 * GET /api/analyses/[id]/chapters
 * Returns the chapter markers parsed from the video description for the
 * analysis's video (transcript_chapters rows, ordered by start_seconds).
 * Security: enforces ownership (401/404 if user does not own the analysis).
 * Gap 3 wiring (2026-08-05): the client fetches chapters here and threads
 * them into findEntityTimestamp's new third argument.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: analysisId } = await params;

  try {
    const { data: analysis, error } = await verifyResourceOwnership<{ video_id: string }>(
      analysisId,
      'analyses',
      'video_id'
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

    const chapters = await SupabaseTranscriptAdapter.getChapters(analysis.video_id);

    return NextResponse.json({ chapters });

  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { operation: 'get-analysis-chapters' },
      extra: { analysisId },
    });
    console.error('[getAnalysisChapters]', { message: error instanceof Error ? error.message : String(error), analysisId });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
