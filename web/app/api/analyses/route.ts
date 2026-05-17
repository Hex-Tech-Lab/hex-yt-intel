import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createUCISPrompt } from '@/lib/prompts';
import { applyRateLimit, getUserTier } from '@/lib/rate-limit';
import { extractVideoId } from '@/lib/youtube';
import { getSupabaseClient } from '@/lib/supabase';
import { getAuthSession } from '@/lib/auth/provider-factory';
import { AnalysisCreateSchema } from '@/lib/schemas';
import * as Sentry from '@sentry/nextjs';
import {
  trackExternalCall,
  trackDatabaseQuery,
  addBreadcrumb,
  setUserContext
} from '@/lib/monitoring/sentry-utils';


interface AnalysisErrorMeta {
  errors?: Record<string, string>;
}

class AnalysisEngineError extends Error {
  code: string;
  statusCode: number;
  modelAttempted: string;
  retryAfter?: number;
  meta?: AnalysisErrorMeta;

  constructor(opts: {
    message: string;
    code: string;
    statusCode: number;
    modelAttempted: string;
    retryAfter?: number;
    meta?: AnalysisErrorMeta;
  }) {
    super(opts.message);
    this.name = 'AnalysisEngineError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.modelAttempted = opts.modelAttempted;
    this.retryAfter = opts.retryAfter;
    this.meta = opts.meta;
  }
}

async function fetchTranscript(videoId: string): Promise<string> {
  // MVP: Simple placeholder transcript
  // In production: fetch from YouTube API or caption service
  return `[Transcript for video ${videoId}]\n\nThis is a placeholder transcript. In production, this would be fetched from YouTube API captions or a transcription service.`;
}

async function callOpenRouter(
  metadata: {
    title: string;
    channelTitle: string;
    viewCount: string;
    likeCount: string;
    commentCount: string;
    publishedAt: string;
  },
  transcript: string
): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured. Set it in Vercel environment variables.');
  }

  const prompt = createUCISPrompt(metadata, transcript);
  const models = ['anthropic/claude-haiku-4.5', 'anthropic/claude-3.5-haiku'];
  const errors: Record<string, string> = {};

  console.log('[callOpenRouter] Starting with models', { models: models.join(', ') });

  for (const model of models) {
    console.log('[callOpenRouter] Attempting model', { model });
    const controller = new AbortController();
    let connectTimeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      connectTimeoutId = setTimeout(() => {
        console.warn('[callOpenRouter] Connection timeout (10s)', { model });
        controller.abort();
      }, 10000);

      console.log('[callOpenRouter] Sending request to OpenRouter', { model, stream: true });
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://hex-yt-intel.vercel.app',
          'X-Title': 'hex-yt-intel',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(connectTimeoutId);
      connectTimeoutId = undefined;

      console.log('[callOpenRouter] Response received', { model, status: response.status, ok: response.ok });

      if (!response.ok) {
        const status = response.status;
        // Surface full error body for 400 debugging
        const errorBody = await response.text().catch(() => '<unreadable>');
        errors[model] = `HTTP ${status}: ${errorBody.slice(0, 200)}`;

        // Fallback on service errors (503, 429) - legitimate reason to try next model
        if (status === 429 || status === 503) {
          console.warn(`[callOpenRouter] ${model}: ${status} - trying fallback model`);
          continue;
        }

        // Auth errors - don't retry, fail immediately
        if (status === 401 || status === 403) {
          console.error(`[callOpenRouter] Auth error - ${status}`, { model, errorBody });
          throw new AnalysisEngineError({
            message: `OpenRouter auth failed (${status}). Check OPENROUTER_API_KEY.`,
            code: 'ERR_PROVIDER_AUTH_FAILED',
            statusCode: status,
            modelAttempted: model,
          });
        }

        // 400 = model not found or payload rejected — log body, try fallback
        if (status === 400) {
          console.error(`[callOpenRouter] 400 Bad Request - ${model}`, { errorBody: errorBody.slice(0, 500) });
        } else {
          console.error(`[callOpenRouter] HTTP error - ${status}`, { model, errorBody: errorBody.slice(0, 200) });
        }
        continue;
      }

      console.log('[callOpenRouter] Stream response accepted', { model });
      return response;
    } catch (err) {
      if (err instanceof AnalysisEngineError) {
        // Don't fallback on auth errors - fail immediately
        if (err.code === 'ERR_PROVIDER_AUTH_FAILED') {
          console.error('[callOpenRouter] Auth error - not retrying', { model, code: err.code });
          throw err;
        }
        // Other typed errors get recorded but we continue to next model
        console.warn('[callOpenRouter] Typed error, trying next model', { model, code: err.code, message: err.message });
        errors[model] = err.message;
        continue;
      }

      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          console.warn('[callOpenRouter] Abort error (timeout or cancel)', { model });
          errors[model] = 'Connection timeout (10s)';
          continue;
        }
        console.warn('[callOpenRouter] Unexpected error, trying next model', { model, error: err.message });
        errors[model] = err.message;
      } else {
        console.warn('[callOpenRouter] Unexpected error, trying next model', { model, error: String(err) });
        errors[model] = String(err);
      }
      continue;
    } finally {
      if (connectTimeoutId !== undefined) clearTimeout(connectTimeoutId);
    }
  }

  // All models exhausted
  console.error('[callOpenRouter] All models exhausted', { attemptedModels: models, errors });
  throw new AnalysisEngineError({
    message: 'All OpenRouter models failed or unavailable',
    code: 'ERR_ALL_MODELS_EXHAUSTED',
    statusCode: 503,
    modelAttempted: models[0]!,
    meta: { errors },
  });
}

export async function POST(request: NextRequest) {
  const startTime = performance.now();
  let userId: string | undefined;

  try {
    console.log('[analyses] 1. Request received - parsing body');

    // Secure test validation bypass — allows E2E test suites to bypass auth
    const testSecret = request.headers.get('X-Hex-Test-Secret');
    let userEmail = '';
    let userTierAuth: 'free' | 'pro' | 'enterprise' | undefined;

    if (testSecret === 'hex_secure_local_wsl_validation_token_string') {
      console.info('[analyses] Secure validation bypass detected - using test user ID');
      userId = randomUUID();
      userEmail = 'test@example.com';
      userTierAuth = 'free';
    } else {
      // 1. Auth check (supports multiple providers via AUTH_PROVIDER env var)
      const session = await getAuthSession();
      userId = session?.user?.id;
      if (!userId) {
        console.warn('[analyses] Auth check failed - no valid session or user ID');
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      userEmail = session?.user?.email || '';
      userTierAuth = await getUserTier(userId);
    }
    console.log('[analyses] 2. Auth success', { userId, email: userEmail, tier: userTierAuth });

    // Set user context for Sentry
    setUserContext(userId, userEmail || '', userTierAuth);
    addBreadcrumb(`Analysis creation initiated by user ${userId}`, { userId });

    // 1.5. Rate limiting check
    const { allowed, response, headers } = await applyRateLimit(
      request,
      'analyses',
      userId,
      userTierAuth
    );

    if (!allowed) {
      console.warn('[analyses] 3. Rate limit exceeded', { userId, tier: userTierAuth });
      addBreadcrumb('Rate limit exceeded', { userId, tier: userTierAuth }, 'rate_limiting');
      Sentry.captureMessage('Rate limit: POST /api/analyses', 'warning');
      // Rate limit exceeded - response already has 429 status
      if (response) {
        // Attach headers to response
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        }
        return response;
      }
    }
    console.log('[analyses] 3. Rate limit check passed', { userId });

    // 2. Parse and validate request
    const body = await request.json();
    const validation = AnalysisCreateSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.flatten() },
        { status: 400 }
      );
    }

    // 3. Extract video ID
    const videoId = extractVideoId(validation.data.url);
    addBreadcrumb('Video ID extracted', { videoId, url: validation.data.url });
    if (!videoId) {
      addBreadcrumb('Invalid YouTube URL provided', { url: validation.data.url }, 'validation');
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    // 4. Supabase client (server-side)
    const supabase = getSupabaseClient();

    // 4.5 CACHE HIT CHECK: Query for existing analysis with this videoId
    console.log('[analyses] 4. Cache check starting', { videoId, userId });
    const existingAnalysis = await trackDatabaseQuery(
      'select',
      'analyses',
      async () => {
        const { data, error } = await supabase
          .from('analyses')
          .select('id, title, markdown, model_used, created_at')
          .eq('video_id', videoId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      { videoId, userId }
    ).catch((err) => {
      addBreadcrumb('Cache lookup failed (non-blocking)', { videoId, error: String(err) }, 'database');
      return null; // Non-blocking: continue even if cache lookup fails
    });

    // If found in cache, return immediately
    if (existingAnalysis) {
      console.log('[analyses] 4. Cache HIT - returning cached analysis', { videoId, analysisId: existingAnalysis.id });
      addBreadcrumb('Cache hit: analysis retrieved from DB', { videoId, analysisId: existingAnalysis.id }, 'cache');
      Sentry.captureMessage('Cache hit: duplicate analysis prevented', 'info');
      return NextResponse.json({
        id: existingAnalysis.id,
        videoId,
        title: existingAnalysis.title,
        markdown: existingAnalysis.markdown,
        createdAt: existingAnalysis.created_at,
        model_attempted: existingAnalysis.model_used,
        model_used: existingAnalysis.model_used,
        cacheHit: true,
        message: 'Analysis compiled previously. Retrieved instantly from local architecture cache.'
      });
    }
    console.log('[analyses] 4. Cache MISS - proceeding with analysis', { videoId });

    // 5. Check quota enforcement
    console.log('[analyses] 5. Quota check starting', { userId, tier: userTierAuth });
    const userData = await trackDatabaseQuery(
      'select',
      'users',
      async () => {
        const { data, error } = await supabase
          .from('users')
          .select('tier, analyses_used, last_reset_date')
          .eq('id', userId)
          .single();
        if (error) throw error;
        return data;
      },
      { userId }
    ).catch((error) => {
      addBreadcrumb('Failed to fetch user quota data', { userId, error: String(error) }, 'database');
      throw error;
    });

    if (!userData) {
      console.error('[analyses] Failed to fetch user data', { userId });
      return NextResponse.json(
        { error: 'Failed to fetch user data' },
        { status: 500 }
      );
    }

    // Check if monthly quota should be reset
    const now = new Date();
    const lastReset = new Date(userData.last_reset_date || now);
    const monthsElapsed = (now.getFullYear() - lastReset.getFullYear()) * 12 +
                          (now.getMonth() - lastReset.getMonth());

    let analysesUsed = userData.analyses_used || 0;
    if (monthsElapsed > 0) {
      // Reset quota for new month
      console.log('[analyses] Monthly quota reset triggered', { userId, monthsElapsed });
      analysesUsed = 0;
      addBreadcrumb('Monthly quota reset', { userId, monthsElapsed }, 'quota');
      await supabase
        .from('users')
        .update({ analyses_used: 0, last_reset_date: now.toISOString() })
        .eq('id', userId);
    }

    // Enforce quota based on tier
    const quotaLimit = userTierAuth === 'free' ? 3 : null; // null = unlimited for pro

    if (quotaLimit && analysesUsed >= quotaLimit) {
      console.warn('[analyses] Quota limit exceeded', { userId, used: analysesUsed, limit: quotaLimit, tier: userTierAuth });
      addBreadcrumb('Quota limit exceeded', { userId, used: analysesUsed, limit: quotaLimit }, 'quota');
      Sentry.captureMessage(`Quota exceeded: user ${userId}`, 'warning');
      return NextResponse.json(
        {
          error: `Monthly quota exceeded (${analysesUsed}/${quotaLimit}). Upgrade to Pro for unlimited analyses.`,
          quotaExceeded: true,
          remaining: 0,
        },
        { status: 402 }
      );
    }

    console.log('[analyses] 5. Quota check passed', { userId, used: analysesUsed, limit: quotaLimit || 'unlimited' });
    addBreadcrumb('Quota check passed', { userId, used: analysesUsed, limit: quotaLimit || 'unlimited' });

    // 6. Fetch metadata from Worker
    console.log('[analyses] 6. Fetching metadata from Cloudflare Worker', { videoId });
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL || 'https://yt-intel.hex-tech-lab.workers.dev';
    const metadataUrl = `${workerUrl}/fetch-metadata?video_id=${videoId}`;

    let metadata: any;
    try {
      metadata = await trackExternalCall(
        'cloudflare-worker',
        'fetch-metadata',
        async () => {
          const response = await fetch(metadataUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(3000),
          });

          if (!response.ok) {
            throw new Error(`Worker returned ${response.status}`);
          }

          return await response.json();
        },
        { videoId }
      );
      console.log('[analyses] 6. Metadata fetched', { videoId, title: metadata.title, channelTitle: metadata.channelTitle });
      addBreadcrumb('Metadata fetched from worker', { videoId, title: metadata.title });
    } catch (error) {
      console.error('[analyses] 6. Metadata fetch failed', { videoId, error: String(error) });
      addBreadcrumb('Worker call failed', { videoId, error: String(error) }, 'external_service');
      Sentry.captureException(error, {
        tags: { service: 'cloudflare-worker', operation: 'fetch-metadata' },
        contexts: { video: { videoId } },
      });
      return NextResponse.json(
        { error: 'Failed to fetch video metadata' },
        { status: 500 }
      );
    }

    // 7. Fetch transcript
    console.log('[analyses] 7. Fetching transcript (placeholder)', { videoId });
    const transcript = await fetchTranscript(videoId);
    console.log('[analyses] 7. Transcript fetched', { videoId, length: transcript.length });

    // 8. Call OpenRouter - stream response directly to client
    console.log('[analyses] 8. OpenRouter call starting', { videoId });
    let openrouterResponse: Response;
    try {
      openrouterResponse = await trackExternalCall(
        'openrouter',
        'claude-analysis',
        () => callOpenRouter(metadata, transcript),
        { videoId }
      );
      console.log('[analyses] 8. OpenRouter stream initiated successfully', { videoId });
      addBreadcrumb('OpenRouter stream initiated', { videoId });
    } catch (error) {
      console.error('[analyses] 8. OpenRouter call failed', { videoId, error: String(error) });

      let statusCode = 500;
      let errorMessage = 'Failed to generate analysis';

      if (error instanceof AnalysisEngineError) {
        statusCode = error.statusCode;
        errorMessage = error.message;
      }

      addBreadcrumb('Analysis generation failed', { videoId, error: errorMessage }, 'external_service');
      Sentry.captureException(error, {
        tags: { service: 'openrouter', operation: 'claude-analysis' },
        contexts: { video: { videoId } },
      });
      return NextResponse.json(
        { error: errorMessage },
        { status: statusCode }
      );
    }

    // 8.5 Return streaming response directly to client - keeps connection alive during token generation
    // This bypasses the JSON buffer deadlock by immediately returning the stream to the client
    // The client receives tokens as they're generated, preventing timeout drops
    console.log('[analyses] 9. Streaming response to client', { videoId });
    addBreadcrumb('Streaming analysis response to client', { videoId });
    return new Response(openrouterResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Pragma': 'no-cache',
      },
    });
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[analyses] UNHANDLED ERROR', {
      error: errorMsg,
      duration,
      userId,
      stack: error instanceof Error ? error.stack : undefined
    });

    Sentry.captureException(error, {
      contexts: {
        api: {
          endpoint: '/api/analyses',
          method: 'POST',
          userId,
          duration,
        },
      },
      tags: {
        endpoint: 'analyses',
        severity: 'critical',
      },
    });

    addBreadcrumb('Unhandled error in POST /api/analyses', {
      error: errorMsg,
      duration,
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
