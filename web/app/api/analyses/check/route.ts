export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { ERROR_CODES } from '@/lib/error-codes';
import * as Sentry from '@sentry/nextjs';
import { addBreadcrumb, trackDatabaseQuery } from '@/lib/monitoring/sentry-utils';
import { VideoIdSchema } from '@/lib/types/contracts';

export const runtime = 'nodejs';

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
          .select('id, title, analysis_markdown, created_at, model_used')
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

    // If analysis exists and has content, return cached record metadata
    if (existingAnalysis && existingAnalysis.analysis_markdown && existingAnalysis.analysis_markdown.length > 0) {
      console.log('[analyses/check] Cache HIT - analysis found', { videoId: normalizedVideoId, analysisId: existingAnalysis.id });
      addBreadcrumb('Pre-flight check: cache hit', { videoId: normalizedVideoId, analysisId: existingAnalysis.id }, 'cache');

      return NextResponse.json({
        exists: true,
        cached: true,
        analysisId: existingAnalysis.id,
        title: existingAnalysis.title,
        createdAt: existingAnalysis.created_at,
        modelUsed: existingAnalysis.model_used,
      }, { status: 200 });
    }

    // No cached analysis found
    console.log('[analyses/check] Cache MISS - no existing analysis', { videoId: normalizedVideoId });
    addBreadcrumb('Pre-flight check: cache miss', { videoId: normalizedVideoId }, 'cache');

    return NextResponse.json({
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
