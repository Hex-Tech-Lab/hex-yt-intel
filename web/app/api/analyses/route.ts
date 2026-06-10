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
import {
  SupabaseAuthAdapter,
  RedisTrafficAdapter,
  PostgresBillingAdapter,
  WorkerIngestionAdapter,
  SettingsModelAdapter,
  StreamTokenAdapter,
  SupabasePersistenceAdapter,
} from '@/lib/adapters';
// Module-level singleton adapters — created once per cold-start, reused across requests.
const authAdapter = new SupabaseAuthAdapter();
const trafficAdapter = new RedisTrafficAdapter();
const billingAdapter = new PostgresBillingAdapter();
const ingestionAdapter = new WorkerIngestionAdapter();
const modelAdapter = new SettingsModelAdapter();
const tokenAdapter = new StreamTokenAdapter();
const persistenceAdapter = new SupabasePersistenceAdapter();

import { CreateAnalysisUseCase } from '@/lib/usecases/CreateAnalysisUseCase';

const createAnalysisUseCase = new CreateAnalysisUseCase(
  trafficAdapter,
  billingAdapter,
  ingestionAdapter,
  modelAdapter,
  tokenAdapter,
  persistenceAdapter
);

export async function POST(request: NextRequest) {
  let body: { url?: string } | undefined;
  try {
    body = await request.json();
    const validation = AnalysisCreateSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request', details: validation.error.flatten() }, { status: 400 });
    }

    // 1. Auth — STRICT tenant isolation. Identity is derived ONLY from the verified
    // Supabase session; there is no static/bearer test bypass on this route.
    const identity = await authAdapter.authenticate();
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { userId, email: userEmail, tier } = identity;

    // 2. Delegate business logic to the UseCase
    const useCaseResult = await createAnalysisUseCase.execute({
      userId,
      email: userEmail,
      tier,
      url: validation.data.url,
      timezone: validation.data.timezone || 'UTC',
      forceRefresh: validation.data.forceRefresh || false,
      explicitPersona: validation.data.persona as PersonaId | undefined,
      clientIp: request.headers.get('x-forwarded-for') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    if (useCaseResult.type === 'error') {
      return NextResponse.json(
        { error: useCaseResult.message, code: useCaseResult.code },
        { status: useCaseResult.status }
      );
    }

    const responseHeaders = new Headers({ 'X-Active-Persona': useCaseResult.data.persona });
    if (useCaseResult.headers) {
      Object.entries(useCaseResult.headers).forEach(([k, v]) => responseHeaders.set(k, v));
    }

    if (useCaseResult.type === 'cache_hit') {
      return NextResponse.json(useCaseResult.data, { headers: responseHeaders });
    }

    // processing
    return NextResponse.json(useCaseResult.data, { status: 202, headers: responseHeaders });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      contexts: { api: { videoId: extractVideoId(body?.url || ''), endpoint: '/api/analyses' } },
    });
    console.error('[analyses] Prepare failed:', { message: errorMessage, url: body?.url });
    return NextResponse.json({ error: errorMessage, code: 'ERR_ANALYSIS_PREPARE_FAILED' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const identity = await authAdapter.authenticate();
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { userId } = identity;

    const historyItems = await persistenceAdapter.getUserHistory({ userId });

    return NextResponse.json({ analyses: historyItems }, { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[analyses GET] Exception:', { message: errorMessage });
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/analyses (GET)' } } });
    return NextResponse.json({ error: errorMessage, code: 'ERR_ANALYSIS_FETCH_FAILED' }, { status: 500 });
  }
}