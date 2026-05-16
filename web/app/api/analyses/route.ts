import { NextRequest, NextResponse } from 'next/server';
import { createUCISPrompt } from '@/lib/prompts';
import { generateEmbedding } from '@/lib/embeddings';
import { applyRateLimit, getUserTier, checkQuota, incrementQuotaCounter, resetQuotaIfMonthChanged } from '@/lib/rate-limit';
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

interface AnalysisResponse {
  id: string;
  videoId: string;
  title: string;
  markdown: string;
  createdAt: string;
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
): Promise<string> {
  const prompt = createUCISPrompt(metadata, transcript);
  const models = ['anthropic/claude-haiku-4.5', 'anthropic/claude-3.5-haiku'];
  const errors: Record<string, string> = {};

  for (const model of models) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        errors[model] = `${response.status} - ${errorText.slice(0, 100)}`;

        if (response.status === 404) {
          console.warn(`[callOpenRouter] ${model}: 404 not found`);
          continue;
        }
        if (response.status === 401) {
          console.warn(`[callOpenRouter] ${model}: 401 unauthorized (check API key)`);
          continue;
        }
        console.warn(`[callOpenRouter] ${model}: ${response.status} ${errorText.slice(0, 80)}`);
        continue;
      }

      const data = await response.json();
      console.log(`[callOpenRouter] ✓ Success with ${model}`);
      return data.choices[0].message.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors[model] = msg.slice(0, 100);
      console.warn(`[callOpenRouter] ${model}: ${msg.slice(0, 80)}`);
    }
  }

  throw new Error(`All OpenRouter models exhausted: ${JSON.stringify(errors)}`);
}

export async function POST(request: NextRequest) {
  const startTime = performance.now();
  let userId: string | undefined;

  try {
    console.log('[/api/analyses] POST request received');

    // 1. Auth check (supports multiple providers via AUTH_PROVIDER env var)
    console.log('[/api/analyses] Checking auth...');
    const session = await getAuthSession();
    console.log('[/api/analyses] Session:', { hasUser: !!session?.user, userEmail: session?.user?.email });

    if (!session?.user) {
      console.log('[/api/analyses] Auth failed - no session');
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

    // 5. Check and enforce monthly analysis quota (Redis-backed)
    // Reset counter if month has changed since last check
    await resetQuotaIfMonthChanged(userId);

    // Check current quota status
    const quotaStatus = await checkQuota(userId, userTierAuth);
    addBreadcrumb('Quota status checked', {
      userId,
      count: quotaStatus.count,
      limit: quotaStatus.limit,
      remaining: quotaStatus.remaining,
    });

    // Enforce quota limit
    if (quotaStatus.limit !== null && quotaStatus.count >= quotaStatus.limit) {
      addBreadcrumb('Quota limit exceeded', {
        userId,
        used: quotaStatus.count,
        limit: quotaStatus.limit,
      }, 'quota');
      Sentry.captureMessage(`Quota exceeded: user ${userId}`, 'warning');
      return NextResponse.json(
        {
          error: `Monthly quota exceeded (${quotaStatus.count}/${quotaStatus.limit}). Upgrade to Pro for unlimited analyses.`,
          quotaExceeded: true,
          remaining: 0,
          resetAt: quotaStatus.reset.toISOString(),
        },
        { status: 402 }
      );
    }

    addBreadcrumb('Quota check passed', {
      userId,
      used: quotaStatus.count,
      limit: quotaStatus.limit || 'unlimited',
      remaining: quotaStatus.remaining,
    });

    // 6. Fetch metadata from Worker
    console.log('[/api/analyses] Fetching metadata from worker...');
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL || 'https://yt-intel.hex-tech-lab.workers.dev';
    const metadataUrl = `${workerUrl}/fetch-metadata?video_id=${videoId}`;
    console.log('[/api/analyses] Worker URL:', workerUrl);

    let metadata: any;
    try {
      metadata = await trackExternalCall(
        'cloudflare-worker',
        'fetch-metadata',
        async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);

          try {
            console.log('[/api/analyses] Calling worker:', metadataUrl);
            const response = await fetch(metadataUrl, {
              method: 'GET',
              signal: controller.signal,
            });

            clearTimeout(timeout);
            console.log('[/api/analyses] Worker response status:', response.status);

            if (!response.ok) {
              const errorText = await response.text();
              console.error('[/api/analyses] Worker error:', errorText);
              throw new Error(`Worker returned ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log('[/api/analyses] Worker returned metadata:', { title: data.title, viewCount: data.viewCount });
            return data;
          } finally {
            clearTimeout(timeout);
          }
        },
        { videoId }
      );
      addBreadcrumb('Metadata fetched from worker', { videoId, title: metadata.title });
    } catch (error) {
      console.error('[/api/analyses] Worker call failed:', error);
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
    console.log('[/api/analyses] Calling OpenRouter...');
    console.log('[/api/analyses] OpenRouter API key set:', !!process.env.OPENROUTER_API_KEY);

    let markdown: string;
    try {
      markdown = await trackExternalCall(
        'openrouter',
        'claude-analysis',
        () => callOpenRouter(metadata, transcript),
        { videoId, model: 'anthropic/claude-3.5-haiku' }
      );
      console.log('[/api/analyses] Analysis generated successfully, length:', markdown.length);
      addBreadcrumb('Analysis generated successfully', { videoId, markdownLength: markdown.length });
    } catch (error) {
      console.error('[/api/analyses] OpenRouter error:', error);
      addBreadcrumb('Analysis generation failed', { videoId, error: String(error) }, 'external_service');
      Sentry.captureException(error, {
        tags: { service: 'openrouter', operation: 'claude-analysis' },
        contexts: { video: { videoId } },
      });
      return NextResponse.json(
        { error: 'Failed to generate analysis' },
        { status: 500 }
      );
    }

    // 9. Upsert analysis into Supabase (idempotent on user_id + video_id)
    // unique constraint "unique_user_video" on (user_id, video_id) prevents
    // duplicate rows; upsert updates the existing record instead of 23505.
    const analysisPayload = {
      user_id: userId,
      video_id: videoId,
      title: metadata.title || '',
      channel_title: metadata.channelTitle || '',
      view_count: parseInt(metadata.viewCount || '0', 10),
      analysis_markdown: markdown,
      embedding: null,
    };

    const analysis = await trackDatabaseQuery(
      'upsert',
      'analyses',
      async () => {
        const { data, error } = await supabase
          .from('analyses')
          .upsert(analysisPayload, {
            onConflict: 'user_id,video_id',
          })
          .select('id, created_at')
          .single();

        if (error) {
          console.error('[/api/analyses] Upsert error:', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
            payloadKeys: Object.keys(analysisPayload),
          });

          if (error.code === '42501') {
            throw new Error(`RLS policy blocked analyses upsert: ${error.message}`);
          }
          if (error.code === '23505') {
            // Should not reach here because upsert handles 23505, but log if it does
            console.error('[/api/analyses] Unexpected 23505 on upsert:', error.details);
          }
          throw error;
        }
        return data;
      },
      { userId, videoId }
    ).catch((error) => {
      addBreadcrumb('Analysis upsert failed', { userId, videoId, error: String(error) }, 'database');
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

    // 10. Increment monthly quota counter (Redis-backed)
    const newCount = await incrementQuotaCounter(userId);
    addBreadcrumb('Monthly quota counter incremented', {
      userId,
      newCount,
      tier: userTierAuth,
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
