export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Bouncer only: auth + quota + ingestion + mint a streaming token, then return fast.
// The slow LLM generation streams directly browser<->Cloudflare Worker (no Vercel
// function in the LLM path), so the 60s Hobby ceiling never applies. ~8s typical.
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { AnalysisCreateSchema } from '@/lib/types/contracts';
import type { PersonaId } from '@/lib/prompts';
import { extractVideoId } from '@/lib/youtube';
import * as Sentry from '@sentry/nextjs';
import { ERROR_PHASES } from '@/lib/error-codes';
import { categorizeError, createErrorResponse } from '@/lib/services/error-handler';
import { detectClientPlatform } from '@/lib/utils/client-platform';
import {
  SupabaseAuthAdapter,
  WorkerIngestionAdapter,
  SupabasePersistenceAdapter,
  PostgresBillingAdapter,
  SettingsModelAdapter,
  StreamTokenAdapter,
  SupabaseCommentSamplingAdapter,
} from '@/lib/adapters';

// Module-level singleton adapters — created once per cold-start, reused across requests.
const authAdapter = new SupabaseAuthAdapter();
const ingestionAdapter = new WorkerIngestionAdapter();
const persistenceAdapter = new SupabasePersistenceAdapter();
const billingAdapter = new PostgresBillingAdapter();
const modelResolutionAdapter = new SettingsModelAdapter();
const tokenAdapter = new StreamTokenAdapter();
const commentSamplingAdapter = new SupabaseCommentSamplingAdapter();

import { CreateAnalysisUseCase } from '@/lib/usecases/CreateAnalysisUseCase';

const createAnalysisUseCase = new CreateAnalysisUseCase(
  ingestionAdapter,
  persistenceAdapter,
  billingAdapter,
  modelResolutionAdapter,
  tokenAdapter,
  commentSamplingAdapter
);


export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  let body: { url?: string; timezone?: string; persona?: string; forceRefresh?: boolean } | undefined;

  try {
    // 1. Parse and validate request
    try {
      body = await request.json();
    } catch (parseErr) {
      const err = categorizeError(parseErr, ERROR_PHASES.REQUEST_VALIDATION);
      Sentry.captureException(parseErr, {
        tags: { operation: 'analysis-create', phase: 'json_parse', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/analyses' } }
      });
      console.error('[analyses] JSON parse error', { requestId, message: err.message });
      return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
    }

    const validation = AnalysisCreateSchema.safeParse(body);
    if (!validation.success) {
      const err = categorizeError(validation.error, ERROR_PHASES.REQUEST_VALIDATION);
      console.warn('[analyses] Invalid payload schema', { requestId, issues: validation.error.issues.length });
      Sentry.captureMessage('Analysis: Invalid request schema', {
        level: 'warning',
        tags: { operation: 'analysis-create', phase: 'schema_validation', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/analyses' }, validation: { issues: validation.error.issues } }
      });
      return NextResponse.json({ ...createErrorResponse(err), details: validation.error.flatten() }, { status: err.statusCode });
    }

    // 2. Auth — STRICT tenant isolation. Identity is derived ONLY from the verified
    // Supabase session; there is no static/bearer test bypass on this route.
    const identity = await authAdapter.authenticate();
    if (!identity) {
      const err = categorizeError(new Error('No identity'), ERROR_PHASES.AUTHENTICATION);
      console.warn('[analyses] Authentication failed', { requestId });
      Sentry.captureMessage('Analysis: Authentication failed', {
        level: 'warning',
        tags: { operation: 'analysis-create', phase: 'authentication', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/analyses' } }
      });
      return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
    }

    // 3. Delegate business logic to the UseCase
    const useCaseResult = await createAnalysisUseCase.execute({
      url: validation.data.url,
      userId: identity.userId,
      tier: identity.tier,
      email: identity.email,
      timezone: validation.data.timezone,
      persona: validation.data.persona as PersonaId | undefined,
      forceRefresh: validation.data.forceRefresh,
      // Cosmetic-only device signal (RCA 2026-07-24: cross-account confusion
      // traced to "which device did I use" having no UI answer). Never used
      // for auth/billing/security decisions.
      clientPlatform: detectClientPlatform(request.headers.get('user-agent')),
    });

    if (useCaseResult.type === 'error') {
      const duration = Date.now() - startTime;
      console.warn('[analyses] Business logic error', { requestId, code: useCaseResult.code, duration });
      Sentry.captureMessage('Analysis: Business logic error', {
        level: 'warning',
        tags: { operation: 'analysis-create', phase: 'business_logic', code: useCaseResult.code },
        contexts: { api: { requestId, userId: identity.userId, endpoint: '/api/analyses', duration } }
      });
      return NextResponse.json(
        { error: useCaseResult.message, code: useCaseResult.code },
        { status: useCaseResult.status }
      );
    }

    const responseHeaders = new Headers({ 'X-Active-Persona': useCaseResult.persona });
    if (useCaseResult.headers) {
      Object.entries(useCaseResult.headers).forEach(([k, v]) => responseHeaders.set(k, String(v)));
    }

    const duration = Date.now() - startTime;
    const cacheHit = useCaseResult.type === 'cache_hit';
    console.info('[analyses] Request completed', { requestId, userId: identity.userId, cacheHit, duration });

    if (useCaseResult.type === 'cache_hit') {
      return NextResponse.json(useCaseResult.data, { headers: responseHeaders });
    }

    // processing
    return NextResponse.json(useCaseResult.data, { status: 202, headers: responseHeaders });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const videoId = extractVideoId((body?.url as string) || '');

    Sentry.captureException(error, {
      tags: { operation: 'analysis-create', phase: 'unknown' },
      contexts: { api: { requestId, videoId, endpoint: '/api/analyses', duration } },
    });
    console.error('[analyses] Unexpected error', { requestId, message: errorMessage, videoId, duration });
    const err = categorizeError(error, ERROR_PHASES.BUSINESS_LOGIC);
    return NextResponse.json(createErrorResponse(err), { status: 500 });
  }
}

export async function GET() {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  try {
    const identity = await authAdapter.authenticate();
    if (!identity) {
      const err = categorizeError(new Error('No identity'), ERROR_PHASES.AUTHENTICATION);
      console.warn('[analyses GET] Authentication failed', { requestId });
      Sentry.captureMessage('Analysis: GET authentication failed', {
        level: 'warning',
        tags: { operation: 'analysis-list', phase: 'authentication', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/analyses (GET)' } }
      });
      return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
    }
    const { userId } = identity;

    let historyItems;
    try {
      historyItems = await persistenceAdapter.getUserHistory({ userId });
    } catch (error) {
      const err = categorizeError(error, ERROR_PHASES.DATABASE_FETCH);
      Sentry.captureException(error, {
        tags: { operation: 'analysis-list', phase: 'database_fetch', retryable: String(err.retryable) },
        contexts: { api: { requestId, userId, endpoint: '/api/analyses (GET)' } }
      });
      console.error('[analyses GET] Database fetch failed', { requestId, userId, error: err.message, retryable: err.retryable });
      return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
    }

    const duration = Date.now() - startTime;
    console.info('[analyses GET] History retrieved successfully', { requestId, userId, count: historyItems.length, duration });
    return NextResponse.json({ analyses: historyItems }, { status: 200 });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[analyses GET] Unexpected error', { requestId, message: errorMessage, duration });
    Sentry.captureException(error, {
      tags: { operation: 'analysis-list', phase: 'unknown' },
      contexts: { api: { requestId, endpoint: '/api/analyses (GET)', duration } }
    });
    const err = categorizeError(error, ERROR_PHASES.BUSINESS_LOGIC);
    return NextResponse.json(createErrorResponse(err), { status: 500 });
  }
}