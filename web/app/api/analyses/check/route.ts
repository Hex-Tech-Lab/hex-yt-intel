export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { ERROR_CODES } from '@/lib/error-codes';
import * as Sentry from '@sentry/nextjs';
import { addBreadcrumb, trackDatabaseQuery } from '@/lib/monitoring/sentry-utils';
import { VideoIdSchema } from '@/lib/types/contracts';

export const runtime = 'edge';

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

    // Check if analysis exists for this user/video combination
    const existingAnalysis = await trackDatabaseQuery(
      'select',
      'analyses',
      async () => {
        const { data, error } = await supabase
          .from('analyses')
          .select('id, title, channel_title, analysis_markdown, created_at, model_used, validation_report, billing_status')
          .eq('video_id', normalizedVideoId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        return data;
      },
      { videoId: normalizedVideoId, userId }
    ).catch((err) => {
      addBreadcrumb('Pre-flight cache check failed', { videoId: normalizedVideoId, error: String(err) }, 'database');
      return null;
    });

    if (existingAnalysis) {
      // Enforce compatibility with the PR #36 / PR #40 serialization structures
      const validationReport = (existingAnalysis.validation_report as any) || {};
      const metadataPayload = validationReport.metadata || (existingAnalysis as any).metadata || {};

      // NOTE: `analyses` has no `status` column — completeness lives in
      // `billing_status`. Analysis is complete when billing_status='chargeable'
      // (ready to charge) or 'charged' (payment processed).
      // Also restore partial analyses (billing_status='failed' but has dimensions).
      if (existingAnalysis.billing_status === 'chargeable' || existingAnalysis.billing_status === 'charged') {
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
      const PROCESSING_STALE_MS = 120_000;
      const ageMs = Date.now() - new Date(existingAnalysis.created_at).getTime();

      if (validationReport.status === 'error') {
        return NextResponse.json({
          status: 'error',
          exists: true,
          analysisId: existingAnalysis.id,
          error: validationReport.error || 'Analysis generation failed',
        }, { status: 200 });
      }

      // Restore partial analyses (billing_status='failed' but has validation data)
      if (existingAnalysis.billing_status === 'failed' && validationReport.status !== 'failed') {
        return NextResponse.json({
          exists: true,
          status: 'complete',  // Treat partial as restoreable
          analysisId: existingAnalysis.id,
          title: existingAnalysis.title,
          channelTitle: existingAnalysis.channel_title,
          metadata: metadataPayload
        }, { status: 200 });
      }

      if (ageMs >= PROCESSING_STALE_MS) {
        return NextResponse.json({
          status: 'error',
          exists: true,
          analysisId: existingAnalysis.id,
          error: 'Analysis generation timed out. Please try again.',
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
