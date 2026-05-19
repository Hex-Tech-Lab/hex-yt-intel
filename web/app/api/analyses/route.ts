import { NextRequest, NextResponse, after } from 'next/server';
import { detectPersona, rankPersonas, type PersonaId } from '@/lib/prompts';
import { applyRateLimit, getUserTier } from '@/lib/rate-limit';
import { extractVideoId } from '@/lib/youtube';
import { getSupabaseClient } from '@/lib/supabase';
import { getAuthSession } from '@/lib/auth/provider-factory';
import { AnalysisCreateSchema } from '@/lib/schemas';
import { fetchWorkerMetadata } from '@/lib/worker-client';
import * as Sentry from '@sentry/nextjs';

export const runtime = 'nodejs';
import {
  trackExternalCall,
  trackDatabaseQuery,
  addBreadcrumb,
  setUserContext
} from '@/lib/monitoring/sentry-utils';
import { callOpenRouter, AnalysisEngineError } from '@/lib/services/openrouter';
import { createClaudeStreamNormalizer } from '@/lib/streaming';
import { publishValidationTask } from '@/lib/qstash-client';

async function fetchTranscript(videoId: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL || 'https://yt-intel.hex-tech-lab.workers.dev';

    if (!workerUrl || workerUrl.includes('[build-time-placeholder')) {
      clearTimeout(timeout);
      throw new Error('Cloudflare Worker URL not configured in production environment');
    }

    const transcriptUrl = `${workerUrl}/fetch-transcript?video_id=${videoId}`;
    const response = await fetch(transcriptUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Worker returned ${response.status} for transcript fetch`);
    }

    const data = await response.json();

    if (!data.transcript || typeof data.transcript !== 'string') {
      throw new Error('Worker returned invalid transcript format');
    }

    return data.transcript;
  } catch (error) {
    clearTimeout(timeout);

    const errorMsg = error instanceof Error ? error.message : 'Unknown error fetching transcript';

    // Hard failure: never return placeholder, always throw
    const fullError = new Error(`Failed to fetch transcript from Cloudflare Worker: ${errorMsg}`);
    console.error('[fetchTranscript] CRITICAL:', fullError);
    throw fullError;
  }
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
      console.info('[analyses] Secure validation bypass detected - using persistent test user');
      userId = 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb';
      userEmail = 'kellybakri@gmail.com';
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

    // Extract timezone and persona from validated request
    const timezone = validation.data.timezone || 'Africa/Cairo';
    let selectedPersona: PersonaId | null = validation.data.persona as PersonaId | null;

    // 3. Extract video ID
    const videoId = extractVideoId(validation.data.url);
    if (!videoId) {
      addBreadcrumb('Invalid YouTube URL provided', { url: validation.data.url }, 'validation');
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }
    addBreadcrumb('Video ID extracted', { videoId, url: validation.data.url });

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
        analysisId: existingAnalysis.id,
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

    // 6. Fetch metadata from Worker (using centralized wrapper)
    console.log('[analyses] 6. Fetching metadata from Cloudflare Worker', { videoId });
    let metadata: any;
    try {
      metadata = await trackExternalCall(
        'cloudflare-worker',
        'fetch-metadata',
        () => fetchWorkerMetadata(videoId),
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

    // 6.5 Persona selection (explicit param overrides auto-detection)
    if (!selectedPersona) {
      selectedPersona = detectPersona(metadata.title, metadata.channelTitle);
      console.log('[analyses] 6.5 Persona auto-detected', { videoId, persona: selectedPersona });
    } else {
      console.log('[analyses] 6.5 Persona explicitly set', { videoId, persona: selectedPersona });
    }
    // Assert selectedPersona is now defined (either from auto-detect or explicit)
    const finalPersona: PersonaId = selectedPersona!;
    const personaConfig = rankPersonas(finalPersona);
    addBreadcrumb('Persona configured', { persona: selectedPersona, ranks: personaConfig.map((p) => `${p.personaId}:${p.weight}%`).join(' ') });

    // 7. Fetch transcript from Cloudflare Worker
    console.log('[analyses] 7. Fetching transcript from worker', { videoId });
    const transcript = await fetchTranscript(videoId);
    console.log('[analyses] 7. Transcript fetched', { videoId, length: transcript.length });

    // 8. Call OpenRouter - stream response directly to client
    console.log('[analyses] 8. OpenRouter call starting', { videoId, persona: finalPersona, timezone, duration: metadata.duration });
    let openrouterResponse: Response;
    try {
      openrouterResponse = await trackExternalCall(
        'openrouter',
        'claude-analysis',
        () => callOpenRouter(metadata, transcript, finalPersona, timezone, metadata.duration || undefined),
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

    // 8.5 Create analysis record in database (before streaming) - BLOCKING INSERT
    console.log('[analyses] 9. Creating analysis record', { videoId, userId });
    const analysisId = crypto.randomUUID();
    try {
      await trackDatabaseQuery(
        'insert',
        'analyses',
        async () => {
          const { error } = await supabase
            .from('analyses')
            .insert({
              id: analysisId,
              video_id: videoId,
              user_id: userId,
              title: metadata.title,
              markdown: '', // Will be populated after streaming
              model_attempted: 'anthropic/claude-haiku-4.5',
              model_used: 'anthropic/claude-haiku-4.5',
              validation_report: null,
              validation_passed: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          if (error) throw error;
        },
        { analysisId, videoId, userId }
      );
    } catch (insertErr) {
      console.error('[analyses] Failed to create analysis record', { analysisId, error: String(insertErr) });
      addBreadcrumb('Analysis record creation failed', { analysisId }, 'database');
      Sentry.captureException(insertErr, { tags: { operation: 'analysis-insert' } });
      return NextResponse.json(
        { error: 'Failed to create analysis record' },
        { status: 500 }
      );
    }

    // 9.5 Return streaming response with SSE normalization for Claude 4.5 compatibility
    // Transform raw OpenRouter stream to normalize Claude 4.5's delta format
    console.log('[analyses] 10. Setting up stream transformer for Claude 4.5 normalization', { videoId });
    addBreadcrumb('Streaming analysis response to client', { videoId });

    const transformedStream = openrouterResponse.body!.pipeThrough(createClaudeStreamNormalizer());

    // Tee the stream so one branch goes to client, the other to async processor
    const [clientStream, processorStream] = transformedStream.tee();

    // Inject persona header and wrap client stream in response
    const streamResponse = new Response(clientStream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Pragma': 'no-cache',
        'X-Active-Persona': finalPersona,
        'X-Persona-Config': JSON.stringify(personaConfig),
      },
    });

    // Process validator stream asynchronously via QStash (guaranteed delivery)
    // Collect streamed chunks, save markdown, and trigger validation via webhook
    // Note: Streaming response keeps connection alive, preventing Vercel timeout
    console.log('[analyses] 11. Setting up async validation via QStash', { analysisId });
    after(async () => {
      try {
        const reader = processorStream.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        // Reconstruct markdown from SSE stream chunks
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        const fullOutput = new TextDecoder().decode(combined);

        // Extract markdown from SSE format
        const lines = fullOutput.split('\n');
        let markdown = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            if (dataStr && dataStr !== '[DONE]') {
              try {
                const json = JSON.parse(dataStr);
                const token = json.choices?.[0]?.delta?.content || '';
                markdown += token;
              } catch {
                // Skip malformed chunks
              }
            }
          }
        }

        if (markdown.length > 0) {
          console.log('[analyses] 11. Markdown collected, updating analysis record', { analysisId, length: markdown.length });

          // Update analysis record with collected markdown (blocking operation)
          try {
            await trackDatabaseQuery(
              'update',
              'analyses',
              async () => {
                const { error } = await supabase
                  .from('analyses')
                  .update({
                    markdown,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', analysisId);
                if (error) throw error;
              },
              { analysisId }
            );
          } catch (updateErr) {
            console.error('[analyses] Failed to update markdown (blocking)', { analysisId, error: String(updateErr) });
            addBreadcrumb('Markdown update failed', { analysisId }, 'database');
            throw updateErr;
          }

          // Publish validation task to QStash (guaranteed delivery with retries)
          if (markdown.length > 100) {
            const now = new Date();
            const dateStr = now.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
            const filename = `${metadata.title.slice(0, 80).replace(/[/:?*"]/g, '-')}-${metadata.channelTitle.replace(/[/:?*"]/g, '-')}-${dateStr}.md`;

            console.log('[analyses] 11. Publishing validation task to QStash', { analysisId });
            try {
              await publishValidationTask({
                videoId,
                markdown,
                filename,
                userId: userId!,
                analysisId,
                metadata: {
                  title: metadata.title,
                  channelTitle: metadata.channelTitle,
                  ...(metadata.duration !== undefined && { duration: metadata.duration }),
                },
              });
            } catch (publishErr) {
              console.error('[analyses] Failed to publish validation task (blocking)', {
                analysisId,
                error: String(publishErr),
              });
              addBreadcrumb('Validation task publish failed', { analysisId }, 'qstash');
              throw publishErr;
            }
          }
        }
      } catch (processingError) {
        console.error('[analyses] Async processing error (after handler)', {
          analysisId,
          error: String(processingError),
        });
        Sentry.captureException(processingError, {
          tags: { service: 'async-processor', operation: 'stream-processing' },
          contexts: { analysis: { analysisId } },
        });
      }
    });

    return streamResponse;
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
