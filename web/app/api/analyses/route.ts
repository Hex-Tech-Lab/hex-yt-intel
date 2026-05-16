import { NextRequest, NextResponse } from 'next/server';
import { createUCISPrompt } from '@/lib/prompts';
import { generateEmbedding } from '@/lib/embeddings';
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

export const runtime = 'edge';

interface AnalysisResponse {
  id: string;
  videoId: string;
  title: string;
  markdown: string;
  createdAt: string;
  model_attempted: string;
  model_used: string;
  cacheHit?: boolean;
  message?: string;
}

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
): Promise<{ content: string; model: string }> {
  // Defensive runtime check - will fail fast if key is missing
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured. Set it in Vercel environment variables.');
  }

  const prompt = createUCISPrompt(metadata, transcript);
  const models = ['anthropic/claude-haiku-4.5', 'anthropic/claude-3.5-haiku'];
  const errors: Record<string, string> = {};
  const transcriptLength = transcript?.length || 0;
  const adaptiveTimeout = Math.min(25000, 5000 + Math.floor(transcriptLength / 5000) * 1000);

  for (const model of models) {
    const controller = new AbortController();
    let connectTimeoutId: NodeJS.Timeout | undefined;
    let totalTimeoutId: NodeJS.Timeout | undefined;
    let timeoutSource: 'connect' | 'total' | null = null;

    try {
      connectTimeoutId = setTimeout(() => {
        timeoutSource = 'connect';
        controller.abort();
      }, 3000);
      totalTimeoutId = setTimeout(() => {
        timeoutSource = 'total';
        controller.abort();
      }, adaptiveTimeout);

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
              role: 'system',
              content: 'You are an expert YouTube content analyst. Generate a comprehensive 16-section content intelligence report in markdown format.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 4000,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(connectTimeoutId);
      connectTimeoutId = undefined;

      if (!response.ok) {
        // --- Response-level error classification ---
        if (response.status === 401 || response.status === 403) {
          throw new AnalysisEngineError({
            message: `OpenRouter ${response.status} — provider authentication failed for model "${model}". Check OPENROUTER_API_KEY.`,
            code: 'ERR_PROVIDER_AUTH_FAILED',
            statusCode: response.status,
            modelAttempted: model,
          });
        }

        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('Retry-After');
          const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
          throw new AnalysisEngineError({
            message: `OpenRouter rate limit exceeded (429) for model "${model}".${retryAfter ? ` Retry after ${retryAfter}s.` : ''}`,
            code: 'ERR_RATE_LIMIT_EXCEEDED',
            statusCode: 429,
            modelAttempted: model,
            retryAfter,
          });
        }

        // 404 = model not found / retired → try next model in the fallback chain
        if (response.status === 404) {
          console.warn(`[callOpenRouter] ${model}: 404 not found`);
          continue;
        }

        // All other non-2xx responses → surface as provider error (stop fallback)
        const errorText = await response.text();
        console.warn(`[callOpenRouter] ${model}: ${response.status} ${errorText.slice(0, 80)}`);
        throw new AnalysisEngineError({
          message: `OpenRouter returned ${response.status} for model "${model}".`,
          code: 'ERR_PROVIDER_HTTP_ERROR',
          statusCode: response.status,
          modelAttempted: model,
        });
      }

      const data = await response.json();

      return { content: data.choices[0].message.content, model };
    } catch (err) {
      // --- Network and unexpected error classification ---
      if (err instanceof AnalysisEngineError) {
        // Rethrow typed errors from the loop body unchanged
        throw err;
      }

      const error = err as Error;
      const msg = error.message;
      
      if (error.name === 'AbortError') {
        if (timeoutSource === 'connect') {
          console.warn(`[callOpenRouter] ${model}: connect handshake timeout – ${msg.slice(0, 80)}`);
          throw new AnalysisEngineError({
            message: `Network timeout — connection to OpenRouter for model "${model}" did not complete handshake within 3s.`,
            code: 'ERR_NETWORK_TIMEOUT',
            statusCode: 408,
            modelAttempted: model,
          });
        } else if (timeoutSource === 'total') {
          console.warn(`[callOpenRouter] ${model}: total task horizon timeout – ${msg.slice(0, 80)}`);
          throw new AnalysisEngineError({
            message: `Task horizon timeout — OpenRouter model "${model}" exceeded ${adaptiveTimeout}ms adaptive execution window.`,
            code: 'ERR_TASK_TIMEOUT',
            statusCode: 408,
            modelAttempted: model,
          });
        }
      }
      // Total-level timeout or other unforeseen fault
      console.warn(`[callOpenRouter] ${model}: total or non-timeout fault – ${msg.slice(0, 80)}`);
      throw new AnalysisEngineError({
        message: `Unexpected error during OpenRouter call for model "${model}": ${msg.slice(0, 120)}`,
        code: 'ERR_UNEXPECTED_FAILURE',
        statusCode: 502,
        modelAttempted: model,
      });
    } finally {
      if (connectTimeoutId !== undefined) clearTimeout(connectTimeoutId);
      if (totalTimeoutId !== undefined) clearTimeout(totalTimeoutId);
    }
  }

  console.error('[callOpenRouter] All models exhausted:', errors);
  throw new AnalysisEngineError({
    message: 'All OpenRouter models exhausted. No model returned a usable response.',
    code: 'ERR_ALL_MODELS_EXHAUSTED',
    statusCode: 502,
    modelAttempted: models.at(-1)!,
    meta: { errors },
  });
}

export async function POST(request: NextRequest) {
  const startTime = performance.now();
  let userId: string | undefined;

  try {
    // 1. Auth check (supports multiple providers via AUTH_PROVIDER env var)
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    userId = session.user.id;
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID not found in session' },
        { status: 401 }
      );
    }
    const userEmail = session.user.email || '';
    const userTierAuth = await getUserTier(userId);

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
          .single();
        if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
        return data || null;
      },
      { videoId, userId }
    ).catch((err) => {
      addBreadcrumb('Cache lookup failed (non-blocking)', { videoId, error: String(err) }, 'database');
      return null; // Non-blocking: continue even if cache lookup fails
    });

    // If found in cache, return immediately
    if (existingAnalysis) {
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

    // 5. Check quota enforcement
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

    addBreadcrumb('Quota check passed', { userId, used: analysesUsed, limit: quotaLimit || 'unlimited' });

    // 6. Fetch metadata from Worker
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL || 'https://yt-intel.hex-tech-lab.workers.dev';
    const metadataUrl = `${workerUrl}/fetch-metadata?video_id=${videoId}`;

    let metadata: any;
    try {
      metadata = await trackExternalCall(
        'cloudflare-worker',
        'fetch-metadata',
        async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);

          try {
            const response = await fetch(metadataUrl, {
              method: 'GET',
              signal: controller.signal,
            });

            clearTimeout(timeout);

            if (!response.ok) {
              throw new Error(`Worker returned ${response.status}`);
            }

            return await response.json();
          } finally {
            clearTimeout(timeout);
          }
        },
        { videoId }
      );
      addBreadcrumb('Metadata fetched from worker', { videoId, title: metadata.title });
    } catch (error) {
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
    const transcript = await fetchTranscript(videoId);

    // 8. Call OpenRouter / Claude Haiku
    let markdown: string;
    let modelUsed: string;
    try {
      const result = await trackExternalCall(
        'openrouter',
        'claude-analysis',
        () => callOpenRouter(metadata, transcript),
        { videoId }
      );
      markdown = result.content;
      modelUsed = result.model;
      addBreadcrumb('Analysis generated successfully', {
        videoId,
        markdownLength: markdown.length,
        modelUsed
      });
    } catch (error) {
      console.error('[/api/analyses] OpenRouter error:', error);

      // Surface typed AnalysisEngineError with precise HTTP status code
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

    // 9. Insert analysis into Supabase (without embedding initially)
    const analysisId = crypto.randomUUID();
    const analysisPayload = {
      id: analysisId,
      user_id: userId,
      video_id: videoId,
      title: metadata.title || '',
      channel_title: metadata.channelTitle || '',
      view_count: parseInt(metadata.viewCount || '0', 10),
      analysis_markdown: markdown,
      model_used: modelUsed,
      embedding: null,
      created_at: new Date().toISOString(),
    };

    const analysis = await trackDatabaseQuery(
      'insert',
      'analyses',
      async () => {
        const { error } = await supabase
          .from('analyses')
          .insert(analysisPayload);

        if (error) {
          console.error('[/api/analyses] Insert error:', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
            payloadKeys: Object.keys(analysisPayload),
          });

          if (error.code === '42501') {
            throw new Error(`RLS policy blocked analyses write: ${error.message}`);
          }
          throw error;
        }

        // INSERT succeeded; return the actual record ID
        return {
          id: analysisId,
          created_at: analysisPayload.created_at,
        };
      },
      { userId, videoId }
    ).catch((error) => {
      addBreadcrumb('Analysis insert failed', { userId, videoId, error: String(error) }, 'database');
      throw error;
    });

    if (!analysis) {
      return NextResponse.json(
        { error: 'Failed to save analysis' },
        { status: 500 }
      );
    }

    addBreadcrumb('Analysis saved to database', { analysisId: analysis.id, videoId });

    // 9.5 Trigger async embedding generation (background job)
    // Don't await: embedding generation is non-blocking
    generateEmbeddingAsync(userId, analysis.id, markdown).catch((error) => {
      console.error('[/api/analyses] Background embedding generation failed:', error);
      // Non-fatal: analysis is already saved
    });

    // 10. Increment user counter
    const newCount = (userData.analyses_used || 0) + 1;
    await trackDatabaseQuery(
      'update',
      'users',
      async () => {
        await supabase
          .from('users')
          .update({ analyses_used: newCount })
          .eq('id', userId);
        return null;
      },
      { userId, newCount }
    ).catch((error) => {
      console.error('[/api/analyses] Update counter error:', error);
      // Non-fatal: analysis was saved, just counter update failed
      addBreadcrumb('Counter update failed (non-fatal)', { userId, error: String(error) }, 'database');
    });

    // 11. Log usage
    await trackDatabaseQuery(
      'insert',
      'usage_logs',
      async () => {
        await supabase.from('usage_logs').insert({
          user_id: userId,
          action: 'analysis_created',
          metadata: {
            video_id: videoId,
            analysis_id: analysis.id,
            latency_ms: Math.round(performance.now() - startTime),
            tier: userTierAuth,
          },
          created_at: new Date().toISOString(),
        });
        return null;
      },
      { userId, videoId }
    ).catch((error) => {
      console.warn('[/api/analyses] Usage log insert failed:', error);
      // Non-fatal: don't fail the whole request
    });

    // 12. Return response
    const duration = Math.round(performance.now() - startTime);
    addBreadcrumb('Analysis request completed', {
      analysisId: analysis.id,
      videoId,
      duration,
      tier: userTierAuth,
    });

    const result: AnalysisResponse = {
      id: analysis.id,
      videoId,
      title: metadata.title || '',
      markdown,
      createdAt: analysis.created_at,
      model_attempted: modelUsed,
      model_used: modelUsed,
      cacheHit: false,
    };

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    console.error('[/api/analyses] Error:', error);

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
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Background job: Generate and store embedding for analysis
 * Runs asynchronously after analysis is saved
 * Non-blocking: errors are logged but don't fail the analysis creation
 *
 * @param userId - User ID
 * @param analysisId - Analysis ID
 * @param markdown - Analysis markdown content
 */
async function generateEmbeddingAsync(
  userId: string,
  analysisId: string,
  markdown: string
): Promise<void> {
  const supabase = getSupabaseClient();

  try {
    // Generate embedding from analysis markdown
    const embeddingResult = await trackExternalCall(
      'openai',
      'text-embedding-3-small',
      () => generateEmbedding(markdown),
      { analysisId, userId }
    );

    addBreadcrumb('Embedding generated asynchronously', {
      analysisId,
      costUsd: embeddingResult.costUsd,
    });

    // Update analysis with embedding
    await trackDatabaseQuery(
      'update',
      'analyses',
      async () => {
        const { error } = await supabase
          .from('analyses')
          .update({
            embedding: embeddingResult.embedding,
          })
          .eq('id', analysisId)
          .eq('user_id', userId);
        if (error) throw error;
        return null;
      },
      { analysisId, userId }
    );

    // Log embedding generation cost
    await trackDatabaseQuery(
      'insert',
      'usage_logs',
      async () => {
        const { error } = await supabase.from('usage_logs').insert({
          user_id: userId,
          action: 'embedding_generated',
          metadata: {
            analysis_id: analysisId,
            cost_usd: embeddingResult.costUsd,
            model: 'text-embedding-3-small',
          },
          created_at: new Date().toISOString(),
        });
        if (error) throw error;
        return null;
      },
      { userId, analysisId }
    );

    console.log(
      `[generateEmbeddingAsync] Embedding generated for analysis ${analysisId} (cost: $${embeddingResult.costUsd})`
    );
  } catch (error) {
    console.error('[generateEmbeddingAsync] Error:', error);
    Sentry.captureException(error, {
      contexts: {
        background_job: {
          job: 'embedding_generation',
          analysisId,
          userId,
        },
      },
      tags: {
        severity: 'low',
        blocking: false,
      },
    });

    addBreadcrumb('Background embedding generation failed', {
      analysisId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Non-fatal: don't rethrow
  }
}
