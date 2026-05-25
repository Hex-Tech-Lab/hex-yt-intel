export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse, after } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { detectPersona, rankPersonas, type PersonaId } from '@/lib/prompts';
import { applyRateLimit, getUserTier } from '@/lib/rate-limit';
import { extractVideoId } from '@/lib/youtube';
import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';
import { AnalysisCreateSchema } from '@/lib/schemas';
import { fetchWorkerMetadata } from '@/lib/worker-client';
import { ERROR_CODES, type ErrorCode } from '@/lib/error-codes';
import * as Sentry from '@sentry/nextjs';

import {
  trackExternalCall,
  trackDatabaseQuery,
  addBreadcrumb,
  setUserContext
} from '@/lib/monitoring/sentry-utils';
import { callOpenRouter, AnalysisEngineError } from '@/lib/services/openrouter';
import { fetchTranscript } from '@/lib/services/transcript';
import { createClaudeStreamNormalizer } from '@/lib/streaming';
import { publishValidationTask } from '@/lib/qstash-client';
import { parseSSELine } from '@/lib/streaming/decoder';

export const runtime = 'nodejs';

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff: 1s, 2s, 4s (max 10s)
        console.warn(`[analyses] ${operationName} failed on attempt ${attempt + 1}/${maxRetries}. Retrying in ${delayMs}ms...`, { error: lastError.message });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error(`${operationName} failed after ${maxRetries} attempts`);
}

async function publishPdfToQStash(
  markdown: string,
  metadata: { title: string; duration?: string },
  videoId: string,
  analysisId: string,
  maxRetries: number = 3
): Promise<boolean> {
  const pdfQueueUrl = process.env.QSTASH_URL || 'https://qstash.io/v2/publish/http';
  const token = process.env.QSTASH_TOKEN;

  if (!token) {
    const errorCode = ERROR_CODES.ENV_MISSING_VARIABLE;
    Sentry.captureMessage('QSTASH_TOKEN not configured', {
      level: 'error',
      tags: { code: errorCode }
    });
    console.error(`[analyses] QSTASH_TOKEN missing [${errorCode}]`);
    return false;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(pdfQueueUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'hex-yt-intel/1.0',
          },
          body: JSON.stringify({
            url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://hex-yt-intel.vercel.app'}/api/pdf`,
            body: {
              markdown,
              title: metadata.title || 'Analysis',
              videoId,
              fileName: `${videoId}-analysis.pdf`
            },
            retries: 2,
            timeout: 30,
          }),
        });

        clearTimeout(timeout);

        if (response.ok) {
          console.log('[analyses] 12. PDF generation queued successfully', { analysisId, attempt: attempt + 1 });
          addBreadcrumb('PDF generation queued', { analysisId, attempt: attempt + 1 }, 'queue');
          return true;
        }

        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`QStash returned ${response.status}`);
          if (attempt < maxRetries - 1) {
            console.warn(`[analyses] QStash attempt ${attempt + 1} failed with ${response.status}, retrying...`, { analysisId });
            continue;
          }
        } else {
          const errorCode = ERROR_CODES.QSTASH_PUBLISH_FAILED;
          console.warn(`[analyses] PDF queue failed [${errorCode}]`, { analysisId, status: response.status });
          addBreadcrumb('PDF generation queue failed', { analysisId, status: response.status }, 'queue');
          return false;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        console.warn(`[analyses] QStash connection attempt ${attempt + 1} failed, retrying...`, {
          analysisId,
          error: String(lastError),
        });
        continue;
      }
    }
  }

  const errorCode = ERROR_CODES.QSTASH_PUBLISH_FAILED;
  Sentry.captureException(lastError || new Error('QStash publish failed after retries'), {
    tags: { operation: 'pdf-queue-publish', code: errorCode, retries: maxRetries },
    contexts: { queue: { operation: 'pdf-queue-publish', analysisId, attempts: maxRetries } }
  });
  console.error(`[analyses] Failed to queue PDF after ${maxRetries} attempts [${errorCode}]`, {
    analysisId,
    error: String(lastError),
  });
  addBreadcrumb(`Failed to queue PDF after ${maxRetries} retries`, { analysisId }, 'queue');
  return false;
}



export async function POST(request: NextRequest) {
  const startTime = performance.now();
  let userId: string | undefined;

  try {
    console.log('[analyses] 1. Request received - validating ingress perimeter');

    // PERIMETER 0: Parse and validate request BEFORE any business logic
    let body: unknown;
    try {
      body = await request.json();
    } catch (parseErr) {
      const errorCode = ERROR_CODES.INVALID_JSON;
      Sentry.captureException(parseErr, { tags: { operation: 'json-parse', code: errorCode } });
      console.warn(`[analyses] 0. JSON parse error [${errorCode}]`, { error: String(parseErr) });
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    const validation = AnalysisCreateSchema.safeParse(body);
    if (!validation.success) {
      const firstError = validation.error.issues[0];
      const errorCode = ERROR_CODES.INVALID_REQUEST_SCHEMA;
      if (!firstError) {
        Sentry.captureMessage('Unknown validation error', { level: 'warning', tags: { code: errorCode } });
        return NextResponse.json(
          { error: 'Invalid request: unknown validation error' },
          { status: 400 }
        );
      }
      Sentry.captureMessage(`Schema validation failed: ${firstError.message}`, {
        level: 'warning',
        tags: { code: errorCode },
        contexts: { validation: { field: firstError.path.join('.'), message: firstError.message } }
      });
      console.warn(`[analyses] 0. Input validation failed [${errorCode}]`, {
        field: firstError.path.join('.'),
        message: firstError.message,
      });
      return NextResponse.json(
        {
          error: 'Invalid request',
          field: firstError.path.join('.') || 'root',
          message: firstError.message,
        },
        { status: 400 }
      );
    }

    const timezone = validation.data.timezone || 'Africa/Cairo';
    let selectedPersona: PersonaId | null = validation.data.persona as PersonaId | null;
    const forceRefresh = validation.data.forceRefresh || false;

    // Validate YouTube URL and extract video ID at perimeter
    const videoId = extractVideoId(validation.data.url);
    if (!videoId || videoId === 'unknown') {
      const errorCode = ERROR_CODES.INVALID_VIDEO_URL;
      Sentry.captureMessage('Invalid YouTube URL format', {
        level: 'warning',
        tags: { code: errorCode },
        contexts: { url: { url: validation.data.url } }
      });
      console.warn(`[analyses] 0. Video ID extraction failed [${errorCode}]`, { url: validation.data.url });
      addBreadcrumb('Invalid YouTube URL at perimeter', { url: validation.data.url }, 'validation');
      return NextResponse.json(
        { error: 'Unsupported YouTube URL format' },
        { status: 400 }
      );
    }

    console.log('[analyses] 1. Ingress perimeter passed - proceeding to auth', { videoId });

    // sec_002: Force environment gating & hardened bypass header (production safety circuit-breaker)
    const isProduction = process.env.NODE_ENV === 'production';
    const bypassSecret = request.headers.get('X-Hex-Test-Secret');
    const devBypassToken = process.env.DEV_BYPASS_TOKEN;
    let userEmail = '';
    let userTierAuth: 'free' | 'pro' | 'enterprise' | undefined;

    // Bypass if header token equals devBypassToken
    const hasValidBypassToken = devBypassToken && bypassSecret === devBypassToken;
    const shouldAttemptBypass = !isProduction && hasValidBypassToken;

    if (shouldAttemptBypass) {
      // Extract userId from Authorization header if present: "Bearer test-token-ID" or "Bearer user-ID"
      const authHeader = request.headers.get('Authorization');
      const token = authHeader?.replace('Bearer ', '') || '';
      const testUserId = token.startsWith('test-token-') ? token.replace('test-token-', '') : token;
      userId = testUserId || 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb';
      
      userEmail = process.env.DEV_TEST_USER_EMAIL || 'test@example.com';
      
      // Extract tier from userId if it follows test user pattern: "user-tier-001"
      if (userId.includes('pro')) {
        userTierAuth = 'pro';
      } else if (userId.includes('enterprise') || userId.includes('admin')) {
        userTierAuth = 'enterprise';
      } else {
        userTierAuth = 'free';
      }
      
      console.info('[analyses] Secure validation bypass detected', { userId, tier: userTierAuth });
    } else {
      // 1. Auth check (unified to Supabase client)
      const supabase = await getSupabaseClientWithAuth();
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id;
      if (!userId) {
        const errorCode = ERROR_CODES.AUTH_UNAUTHORIZED;
        Sentry.captureMessage('Authentication check failed - no user ID', { level: 'warning', tags: { code: errorCode } });
        console.warn(`[analyses] Auth check failed [${errorCode}]`);
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      userEmail = user?.email || '';
      userTierAuth = (await getUserTier(userId)) ?? 'free';
    }


    // qual_002: Improve observability signal with non-PII correlation identifier
    const emailHash = userEmail ? createHash('sha256').update(userEmail).digest('hex').substring(0, 8) : 'unknown';
    console.log('[analyses] 2. Auth success', { userId, correlationId: emailHash, tier: userTierAuth });

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
      const errorCode = ERROR_CODES.RATE_LIMIT_EXCEEDED;
      Sentry.captureMessage('Rate limit exceeded', {
        level: 'warning',
        tags: { code: errorCode },
        contexts: { user: { userId, tier: userTierAuth } }
      });
      console.warn(`[analyses] 3. Rate limit exceeded [${errorCode}]`, { userId, tier: userTierAuth });
      addBreadcrumb('Rate limit exceeded', { code: errorCode, userId, tier: userTierAuth }, 'rate_limiting');
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

    // 4. Supabase client (server-side)
    const supabase = await getSupabaseClientWithAuth();

    // 4.5 CACHE HIT CHECK: Query for existing analysis with this videoId
    console.log('[analyses] 4. Cache check starting', { videoId, userId, forceRefresh });

    let existingAnalysis = null;

    // Skip cache lookup if forceRefresh is explicitly requested
    if (forceRefresh) {
      console.log('[analyses] 4. Cache BYPASS - forceRefresh flag detected, skipping cache lookup', { videoId });
      addBreadcrumb('Cache bypass requested via forceRefresh flag', { videoId }, 'cache');
    } else {
      // Standard cache lookup flow
      existingAnalysis = await trackDatabaseQuery(
        'select',
        'analyses',
        async () => {
          const { data, error } = await supabase
            .from('analyses')
            .select('id, title, analysis_markdown, model_used, created_at')
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

      // If found in cache with non-empty analysis_markdown, return immediately
      // CRITICAL: Must have analysis_markdown to avoid returning empty content from incomplete analyses
      if (existingAnalysis && existingAnalysis.analysis_markdown && existingAnalysis.analysis_markdown.length > 0) {
        console.log('[analyses] 4. Cache HIT - returning cached analysis', { videoId, analysisId: existingAnalysis.id, markdownLength: existingAnalysis.analysis_markdown.length });
        addBreadcrumb('Cache hit: analysis retrieved from DB', { videoId, analysisId: existingAnalysis.id }, 'cache');
        const cacheResponse = NextResponse.json({
          id: existingAnalysis.id,
          analysisId: existingAnalysis.id,
          videoId,
          title: existingAnalysis.title,
          analysis_markdown: existingAnalysis.analysis_markdown,
          createdAt: existingAnalysis.created_at,
          model_attempted: existingAnalysis.model_used,
          model_used: existingAnalysis.model_used,
          cacheHit: true,
          message: 'Analysis compiled previously. Retrieved instantly from local architecture cache.'
        });

        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            cacheResponse.headers.set(key, value);
          }
        }
        return cacheResponse;
      }
      console.log('[analyses] 4. Cache MISS - proceeding with analysis', { videoId });
    }

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
          .maybeSingle();
        
        if (error) {
          const errorCode = ERROR_CODES.QUOTA_FETCH_FAILED;
          console.warn(`[analyses] Supabase error fetching user quota [${errorCode}]:`, error);
          throw error;
        }

        // If user doesn't exist in DB yet, return a default 'free' state
        // This prevents the 'Null Tier Trap' and unhandled crashes downstream
        if (!data) {
          console.info('[analyses] User not found in database, defaulting to free tier state', { userId });
          return {
            tier: 'free',
            analyses_used: 0,
            last_reset_date: new Date().toISOString()
          };
        }

        return data;
      },
      { userId }
    ).catch((error) => {
      addBreadcrumb('Quota lookup failed (non-blocking fallback)', { userId, error: String(error) }, 'database');
      // Graceful degradation: allow the request to proceed with free tier limits if DB is flaky
      return {
        tier: 'free',
        analyses_used: 0,
        last_reset_date: new Date().toISOString()
      };
    });

    // Check if monthly quota should be reset
    const now = new Date();
    const lastReset = new Date(userData.last_reset_date || now);
    const monthsElapsed = (now.getFullYear() - lastReset.getFullYear()) * 12 +
                          (now.getMonth() - lastReset.getMonth());

    let analysesUsed = userData.analyses_used || 0;
    if (monthsElapsed > 0) {
      // Reset quota for new month using atomic RPC
      console.log('[analyses] Monthly quota reset triggered', { userId, monthsElapsed });
      addBreadcrumb('Monthly quota reset', { userId, monthsElapsed }, 'quota');
      
      const { data: resetData, error: resetError } = await supabase
        .rpc('reset_user_quota', { p_user_id: userId })
        .maybeSingle();

      if (resetError) {
        console.error('[analyses] Failed to reset monthly quota via RPC', { userId, error: resetError });
        Sentry.captureException(resetError, { tags: { operation: 'reset_user_quota' } });
      } else if (resetData) {
        analysesUsed = (resetData as any).new_quota;
      } else {
        analysesUsed = 0;
      }
    }

    // Enforce quota based on tier
    const quotaLimit = userTierAuth === 'free' ? 3 : null; // null = unlimited for pro

    if (quotaLimit && analysesUsed >= quotaLimit) {
      const errorCode = ERROR_CODES.QUOTA_EXCEEDED;
      Sentry.captureMessage(`Quota exceeded for user`, {
        level: 'warning',
        tags: { code: errorCode },
        contexts: { quota: { userId, used: analysesUsed, limit: quotaLimit, tier: userTierAuth } }
      });
      console.warn(`[analyses] Quota limit exceeded [${errorCode}]`, { userId, used: analysesUsed, limit: quotaLimit, tier: userTierAuth });
      addBreadcrumb('Quota limit exceeded', { code: errorCode, userId, used: analysesUsed, limit: quotaLimit }, 'quota');
      return NextResponse.json(
        {
          error: `Monthly quota exceeded (${analysesUsed}/${quotaLimit}). Upgrade to Pro for unlimited analyses.`,
          code: errorCode,
          quotaExceeded: true,
          remaining: 0,
          redirectUrl: "/billing",
          fallbackUrl: "/"
        },
        { status: 402 }
      );
    }

    console.log('[analyses] 5. Quota check passed', { userId, used: analysesUsed, limit: quotaLimit || 'unlimited' });
    addBreadcrumb('Quota check passed', { userId, used: analysesUsed, limit: quotaLimit || 'unlimited' });

    // 5.5 ATOMIC QUOTA INCREMENT: Must happen BEFORE OpenRouter to prevent race
    console.log('[analyses] 5.5 Atomically incrementing quota (before OpenRouter)', { userId, tier: userTierAuth });
    const { data: quotaResult, error: quotaIncrementError } = await supabase
      .rpc('increment_user_quota_atomic', { p_user_id: userId })
      .maybeSingle();

    if (quotaIncrementError) {
      const errorCode = ERROR_CODES.QUOTA_ENFORCEMENT_FAILED;
      Sentry.captureException(quotaIncrementError, {
        tags: { operation: 'increment_user_quota_atomic', code: errorCode },
        contexts: { quota: { userId, tier: userTierAuth, operation: 'atomic_increment' } }
      });
      console.error(`[analyses] Quota increment failed [${errorCode}]`, { userId, error: quotaIncrementError });
      addBreadcrumb('Quota increment failed', { userId, error: String(quotaIncrementError) }, 'quota');
      return NextResponse.json(
        { error: 'Quota enforcement error' },
        { status: 500 }
      );
    }

    // Check if increment succeeded (compare-and-swap succeeded)
    const quotaIncremented = (quotaResult as any)?.success === true;
    if (!quotaIncremented && userTierAuth !== 'enterprise') {
      const errorCode = ERROR_CODES.QUOTA_EXCEEDED;
      Sentry.captureMessage(`Quota exceeded (atomic enforcement)`, {
        level: 'warning',
        tags: { code: errorCode },
        contexts: { quota: { userId, tier: userTierAuth, operation: 'atomic_increment_failed' } }
      });
      console.warn(`[analyses] Quota exceeded at atomic increment [${errorCode}]`, { userId, tier: userTierAuth });
      addBreadcrumb('Quota exceeded (atomic enforcement)', { userId, tier: userTierAuth }, 'quota');
      return NextResponse.json(
        {
          error: `Monthly quota exceeded. Upgrade to Pro for unlimited analyses.`,
          code: errorCode,
          quotaExceeded: true,
          remaining: 0,
          redirectUrl: "/billing",
          fallbackUrl: "/"
        },
        { status: 402 }
      );
    }

    console.log('[analyses] 5.5 Quota increment succeeded', { userId, newQuota: (quotaResult as any)?.new_quota });

    // 6. Fetch metadata AND transcript in parallel (non-blocking isolation)
    console.log('[analyses] 6. Fetching metadata and transcript from Cloudflare Worker (parallel)', { videoId });
    let metadata: any;
    let transcript: string | null = null;

    // Launch both operations in parallel to avoid blocking on external network operations
    const [metadataResult, transcriptResult] = await Promise.allSettled([
      trackExternalCall(
        'cloudflare-worker',
        'fetch-metadata',
        () => fetchWorkerMetadata(videoId),
        { videoId }
      ),
      trackExternalCall(
        'cloudflare-worker',
        'fetch-transcript',
        () => fetchTranscript(videoId),
        { videoId }
      ),
    ]);

    // Handle metadata result (required - fail if unavailable)
    if (metadataResult.status === 'rejected') {
      // Rollback quota increment since analysis cannot proceed
      const { error: decrementError } = await supabase
        .rpc('decrement_user_quota', { p_user_id: userId, p_decrement: 1 })
        .maybeSingle();
      if (decrementError) {
        console.error('[analyses] Failed to decrement quota on metadata fetch failure', { userId, error: decrementError });
        Sentry.captureException(decrementError, { tags: { operation: 'decrement_user_quota_on_metadata_failure' } });
      }

      const errorCode = ERROR_CODES.CLOUDFLARE_METADATA_INVALID;
      Sentry.captureException(metadataResult.reason, {
        tags: { service: 'cloudflare-worker', operation: 'fetch-metadata', code: errorCode },
        contexts: { worker: { service: 'cloudflare-worker', operation: 'fetch-metadata', videoId }, video: { videoId } }
      });
      console.error(`[analyses] 6. Metadata fetch failed [${errorCode}]`, { videoId, error: String(metadataResult.reason) });
      addBreadcrumb('Worker call failed', { videoId, error: String(metadataResult.reason) }, 'external_service');
      return NextResponse.json(
        { error: 'Failed to fetch video metadata' },
        { status: 500 }
      );
    }

    metadata = metadataResult.value;
    console.log('[analyses] 6. Metadata fetched', { videoId, title: metadata.title, channelTitle: metadata.channelTitle });
    addBreadcrumb('Metadata fetched from worker', { videoId, title: metadata.title });

    // Handle transcript result (optional - continue analysis with metadata only if unavailable)
    let transcriptWarning: string | undefined;
    if (transcriptResult.status === 'rejected') {
      const errorCode = ERROR_CODES.CLOUDFLARE_TRANSCRIPT_NOT_FOUND;
      const reason = String(transcriptResult.reason);
      console.warn(`[analyses] 6. Transcript fetch failed [${errorCode}] (optional, continuing with metadata only)`, { videoId, error: reason });
      Sentry.captureMessage('Transcript unavailable for video - proceeding with metadata analysis', {
        level: 'info',
        tags: { service: 'cloudflare-worker', operation: 'fetch-transcript', code: errorCode },
        contexts: { video: { videoId }, transcript: { reason } }
      });
      addBreadcrumb('Transcript unavailable - continuing with metadata only', { videoId, error: reason }, 'external_service');
      transcript = '';
      transcriptWarning = 'Captions unavailable for this video - analysis based on metadata only.';
    } else {
      transcript = transcriptResult.value;

      // Guard: Handle empty transcript gracefully (continue with metadata only)
      if (!transcript || transcript.trim().length === 0) {
        console.info(`[analyses] 6. Transcript empty - continuing with metadata only`, { videoId, transcriptLength: transcript?.length || 0 });
        addBreadcrumb('Empty transcript - continuing with metadata only', { videoId }, 'validation');
        transcript = '';
        transcriptWarning = 'No captions found - analysis based on metadata only.';
      } else {
        console.log('[analyses] 6. Transcript fetched and validated (parallel)', { videoId, length: transcript.length });
        addBreadcrumb('Transcript fetched and validated from worker', { videoId, length: transcript.length });
      }
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

    // 7. Call OpenRouter - stream response directly to client (transcript guaranteed valid)
    console.log('[analyses] 7. OpenRouter call starting', { videoId, persona: finalPersona, timezone, duration: metadata.duration, transcriptLength: transcript!.length });
    let openrouterResponse: Response;
    try {
      openrouterResponse = await trackExternalCall(
        'openrouter',
        'claude-analysis',
        () => callOpenRouter(metadata, transcript!, finalPersona, timezone, metadata.duration || undefined),
        { videoId }
      );
      console.log('[analyses] 7. OpenRouter stream initiated successfully', { videoId });
      addBreadcrumb('OpenRouter stream initiated', { videoId });
    } catch (error) {
      // OpenRouter failed after quota was already incremented
      // Decrement the quota atomically to restore state
      console.warn('[analyses] 7. OpenRouter failed, rolling back quota increment', { userId, videoId });
      const { error: decrementError } = await supabase
        .rpc('decrement_user_quota', { p_user_id: userId, p_decrement: 1 })
        .maybeSingle();
      if (decrementError) {
        console.error('[analyses] Failed to decrement quota on OpenRouter failure', { userId, error: decrementError });
        Sentry.captureException(decrementError, { tags: { operation: 'decrement_user_quota_on_failure' } });
      }

      let errorCode: ErrorCode = ERROR_CODES.ANALYSIS_GENERATION_FAILED;
      let statusCode = 500;
      let errorMessage = 'Failed to generate analysis';

      if (error instanceof AnalysisEngineError) {
        statusCode = error.statusCode;
        errorMessage = error.message;
        // Map specific error types to error codes
        if (error.message.includes('timeout')) {
          errorCode = ERROR_CODES.OPENROUTER_TIMEOUT as ErrorCode;
        } else if (error.message.includes('rate limit')) {
          errorCode = ERROR_CODES.OPENROUTER_RATE_LIMIT as ErrorCode;
        }
      }

      Sentry.captureException(error, {
        tags: { service: 'openrouter', operation: 'claude-analysis', code: errorCode },
        contexts: { openrouter: { service: 'openrouter', operation: 'claude-analysis', videoId, statusCode }, video: { videoId }, error: { statusCode, message: errorMessage } }
      });
      console.error(`[analyses] 7. OpenRouter call failed [${errorCode}]`, { videoId, error: String(error), statusCode });
      addBreadcrumb('Analysis generation failed', { videoId, error: errorMessage }, 'external_service');
      return NextResponse.json(
        { error: errorMessage },
        { status: statusCode }
      );
    }

    // 8.5 Generate analysis ID (non-blocking, used for headers and background task)
    const analysisId = randomUUID();

    // 9. Return streaming response with SSE normalization for Claude 4.5 compatibility
    // Transform raw OpenRouter stream to normalize Claude 4.5's delta format
    console.log('[analyses] 9. Setting up stream transformer for Claude 4.5 normalization', { videoId });
    addBreadcrumb('Streaming analysis response to client', { videoId });

    const transformedStream = openrouterResponse.body!.pipeThrough(createClaudeStreamNormalizer());
    const [clientStream, processorStream] = transformedStream.tee();

    // Inject persona header and wrap stream in response
    const streamHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Pragma': 'no-cache',
      'X-Active-Persona': finalPersona,
      'X-Persona-Config': JSON.stringify(personaConfig),
      'X-Analysis-Id': analysisId,
      'X-Title': encodeURIComponent(metadata.title || 'Analysis Result'),
    };

    if (transcriptWarning) {
      streamHeaders['X-Transcript-Warning'] = transcriptWarning;
    }

    const streamResponse = new Response(clientStream, {
      headers: streamHeaders,
    });

    // 10. Process blocking database inserts and stream parsing in background lifecycle
    after(async () => {
      console.log('[analyses] 10. Background Task: Creating analysis record', { videoId, userId, analysisId });
      try {
        const supabaseService = getSupabaseServiceClient();
        await retryWithBackoff(
          () => trackDatabaseQuery(
            'insert',
            'analyses',
            async () => {
              const { error } = await supabaseService
                .from('analyses')
                .insert({
                  id: analysisId,
                  video_id: videoId,
                  user_id: userId,
                  title: metadata.title,
                  analysis_markdown: '', // Will be populated after streaming
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
          ),
          'database-analysis-insert',
          3
        );

        // 10.5. Quota already incremented atomically before OpenRouter (line 5.5)
        // No additional increment needed here
      } catch (insertErr) {
        const errorCode = ERROR_CODES.DATABASE_ANALYSIS_INSERT_FAILED;
        const errorMsg = (insertErr as Error).message;
        const errorStack = (insertErr as Error).stack;
        console.error('DB_INSERT_FAILURE: Msg:', errorMsg);
        console.error('DB_INSERT_FAILURE: Stack:', errorStack);
        Sentry.captureException(insertErr, {
          tags: { operation: 'background-analysis-insert', code: errorCode },
          contexts: { database: { operation: 'background-analysis-insert', analysisId, videoId, userId, errorMsg, errorStack } }
        });
        console.error(`[analyses] Failed to create analysis record in background after retries [${errorCode}]`, { analysisId, errorMsg });
        addBreadcrumb('Background analysis record creation failed after retries', { analysisId }, 'database');
      }

      console.log('[analyses] 11. Background Task: Collecting markdown and publishing validation', { videoId, analysisId });
      try {
        const reader = processorStream.getReader();
        const decoder = new TextDecoder();
        let markdown = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              const token = parseSSELine(buffer);
              if (token) markdown += token;
            }
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const token = parseSSELine(line);
            if (token) markdown += token;
          }
        }

        // Update DB with markdown (with retry backoff for transient failures)
        await retryWithBackoff(
          () => trackDatabaseQuery(
            'update',
            'analyses',
            async () => {
              const { error } = await supabase
                .from('analyses')
                .update({ analysis_markdown: markdown, updated_at: new Date().toISOString() })
                .eq('id', analysisId);
              if (error) throw error;
            },
            { analysisId }
          ),
          'database-analysis-update',
          3
        );

        // Publish to QStash for validation (only if transcript available)
        if (transcript && transcript.length > 0) {
          await publishValidationTask({
            videoId,
            markdown,
            filename: `${videoId}.md`,
            userId: userId || 'anonymous',
            analysisId,
            metadata: {
              title: metadata.title,
              channelTitle: metadata.channelTitle,
              duration: metadata.duration
            }
          });
        } else {
          console.info('[analyses] 11. Skipping QStash validation - no transcript available', { videoId, analysisId });
        }

        // Trigger PDF generation for PRO users after analysis completes
        if (userTierAuth === 'pro') {
          console.log('[analyses] 12. Triggering PDF generation for PRO user', { analysisId, userId });
          const pdfQueued = await publishPdfToQStash(markdown, metadata, videoId, analysisId);
          if (!pdfQueued) {
            console.warn('[analyses] PDF generation queue failed (non-blocking)', { analysisId });
          }
        }
      } catch (bgErr) {
        const errorCode = ERROR_CODES.ANALYSIS_STREAMING_FAILED;
        Sentry.captureException(bgErr, {
          tags: { operation: 'background-stream-processing', code: errorCode },
          contexts: { database: { operation: 'background-stream-processing', analysisId, videoId, userId } }
        });
        console.error(`[analyses] Background processing failed [${errorCode}]`, { analysisId, error: String(bgErr) });
        addBreadcrumb('Background stream processing failed', { analysisId }, 'database');
      }
    });

    return streamResponse;
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorCode = ERROR_CODES.UNHANDLED_EXCEPTION;

    console.error('[analyses] UNHANDLED ERROR', {
      code: errorCode,
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
          errorCode,
        },
      },
      tags: {
        endpoint: 'analyses',
        severity: 'critical',
        errorCode,
      },
    });

    addBreadcrumb('Unhandled error in POST /api/analyses', {
      code: errorCode,
      error: errorMsg,
      duration,
    });

    return NextResponse.json(
      { error: 'Internal server error', code: errorCode },
      { status: 500 }
    );
  }
}
