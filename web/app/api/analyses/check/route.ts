export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { ERROR_CODES } from '@/lib/error-codes';
import * as Sentry from '@sentry/nextjs';
import { addBreadcrumb, trackDatabaseQuery } from '@/lib/monitoring/sentry-utils';
import { VideoIdSchema } from '@/lib/types/contracts';
import { getMissingDimensionNumbers } from '@/lib/services/chunk-presence';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

export const runtime = 'edge';

/** A processing row this old means its background generator was killed (Vercel maxDuration) or crashed. */
const PROCESSING_STALE_MS = 120_000;

/** GET /api/analyses/check — Poll for cached analysis or in-progress status by video ID. */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');

    // Validate video ID parameter with Zod regex
    const validation = VideoIdSchema.safeParse(videoId);
    if (!validation.success) {
      const errorCode = ERROR_CODES.INVALID_VIDEO_ID;
      Sentry.captureMessage('Pre-flight check: invalid videoId format', {
        level: 'warning',
        tags: { code: errorCode }
      });
      console.warn(`[analyses/check] Invalid videoId format [${errorCode}]`, { videoId, error: validation.error.message });
      return NextResponse.json(
        { error: 'Invalid video ID format', code: errorCode },
        { status: 400 }
      );
    }

    const normalizedVideoId = validation.data;

    // Get authenticated user
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id;

    if (!userId) {
      const authError = new Error('User authentication failed');
      Sentry.captureException(authError, {
        level: 'warning',
        tags: { code: ERROR_CODES.AUTH_UNAUTHORIZED }
      });
      throw authError;
    }

    // Check if analysis exists for this user/video combination. Fetch a
    // small window (not just the single newest row) so a dead/stale
    // in-flight row doesn't permanently shadow a real completed analysis
    // for the same video on every future check.
    const recentAnalyses = await trackDatabaseQuery(
      'select',
      'analyses',
      async () => {
        const { data, error } = await supabase
          .from('analyses')
          .select('id, title, channel_title, analysis_markdown, created_at, updated_at, model_used, validation_report, billing_status')
          .eq('video_id', normalizedVideoId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(5);

        if (error) throw error;
        return data;
      },
      { videoId: normalizedVideoId, userId }
    ).catch((err) => {
      addBreadcrumb('Pre-flight cache check failed', { videoId: normalizedVideoId, error: String(err) }, 'database');
      return null;
    });

    const newestRow = recentAnalyses?.[0] ?? null;
    // Staleness clock must be updated_at, not created_at (same class of bug
    // independently fixed 2026-09-09 in /api/analyses/[id]/status/route.ts,
    // commit 662efa41): the worker touches updated_at on every incremental
    // dimension write, so a genuinely in-flight row keeps resetting this
    // clock. created_at never changes, so any processing row older than
    // PROCESSING_STALE_MS was always misreported as dead here too, even a
    // healthy worker still streaming. Falls back to created_at only when
    // updated_at is absent.
    const newestIsStale = newestRow !== null &&
      newestRow.billing_status !== 'completed' &&
      Date.now() - new Date(newestRow.updated_at || newestRow.created_at).getTime() >= PROCESSING_STALE_MS;
    const latestCompleted = recentAnalyses?.find((a) => a.billing_status === 'completed') ?? null;

    // A stale/dead newest row falls back to the last real completed
    // analysis (if any) instead of surfacing a permanent error/ghost state.
    const existingAnalysis = newestIsStale && latestCompleted ? latestCompleted : newestRow;

    if (existingAnalysis) {
      // Enforce compatibility with the PR #36 / PR #40 serialization structures
      const validationReport = (existingAnalysis.validation_report as any) || {};
      const metadataPayload = validationReport.metadata || (existingAnalysis as any).metadata || {};

      // NOTE: `analyses` has no `status` column — completeness lives in
      // `billing_status`. Analysis is complete when billing_status='completed'.
      // RCA (2026-07-23): 'chargeable'/'charged' were never valid values here
      // -- the DB's CHECK constraint only ever allowed processing|completed|
      // failed. See BillingStatus type for full RCA.
      if (existingAnalysis.billing_status === 'completed') {
        return NextResponse.json({
          exists: true,
          status: 'complete',
          analysisId: existingAnalysis.id,
          title: existingAnalysis.title,
          channelTitle: existingAnalysis.channel_title,
          metadata: metadataPayload
        }, { status: 200 });
      }

      // A processing row this old means its background generator was killed (Vercel
      // maxDuration) or crashed; surface it as a terminal error so the client stops polling.
      // updated_at, not created_at -- see the newestIsStale comment above for the RCA.
      const ageMs = Date.now() - new Date(existingAnalysis.updated_at || existingAnalysis.created_at).getTime();

      // ADR 021 Phase 2 (presence-check-on-resume): on a terminal-error state
      // (dead/stale/failed row), surface which dimensions are already durably
      // covered by completed analysis_chunks rows, so a client retry can know
      // what an LLM re-run would actually need to regenerate instead of
      // blindly redoing all of it (live incident, analysis 32aeeb78:
      // 2/5 chunks durable, a retry would re-pay all 5). Read-only surfacing —
      // the selective-dispatch behavior change is Phase 4. Deliberately NOT
      // computed on the 'processing' poll loop (hot path, reattach handles it)
      // nor the 'complete' branch (definitionally empty). Fail-open: a
      // presence-check failure must never break the check route's own
      // status contract — omit the field and let the client proceed as before.
      const isTerminalError =
        validationReport.status === 'error' ||
        existingAnalysis.billing_status === 'failed' ||
        ageMs >= PROCESSING_STALE_MS;
      let missingDimensions: number[] | undefined;
      if (isTerminalError) {
        missingDimensions = await getMissingDimensionNumbers(existingAnalysis.id, TOTAL_DIMENSIONS).catch((presenceError) => {
          addBreadcrumb('Presence check (missing dimensions) failed', { analysisId: existingAnalysis.id, error: String(presenceError) }, 'database');
          return undefined;
        });
      }

      if (validationReport.status === 'error' || existingAnalysis.billing_status === 'failed') {
        return NextResponse.json({
          status: 'error',
          exists: true,
          analysisId: existingAnalysis.id,
          error: validationReport.error || 'Analysis generation failed',
          missingDimensions,
        }, { status: 200 });
      }

      if (ageMs >= PROCESSING_STALE_MS) {
        return NextResponse.json({
          status: 'error',
          exists: true,
          analysisId: existingAnalysis.id,
          error: 'Analysis generation timed out. Please try again.',
          missingDimensions,
        }, { status: 200 });
      }

      return NextResponse.json({
        status: 'processing',
        exists: true,
        analysisId: existingAnalysis.id,
        title: existingAnalysis.title,
      }, { status: 200 });
    }

    // 3. No row at all → nothing in flight.
    console.log('[analyses/check] NONE - no existing analysis', { videoId: normalizedVideoId });
    addBreadcrumb('Poll: none', { videoId: normalizedVideoId }, 'cache');

    return NextResponse.json({
      status: 'none',
      exists: false,
      cached: false,
      analysisId: null,
    }, { status: 200 });
  } catch (error) {
    const errorCode = ERROR_CODES.UNHANDLED_EXCEPTION;
    Sentry.captureException(error, {
      tags: { operation: 'pre-flight-check', code: errorCode },
      contexts: { api: { endpoint: '/api/analyses/check' } }
    });
    console.error('[analyses/check] Unhandled error', { error: String(error), code: errorCode });
    addBreadcrumb('Pre-flight check failed with unhandled error', { error: String(error) }, 'error');

    return NextResponse.json(
      { error: 'Pre-flight check failed', code: errorCode },
      { status: 500 }
    );
  }
}
