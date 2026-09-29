export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Each remediation candidate can spend up to ~270s on a real external LLM
// call (the same ceiling the remediate-dimensions webhook documents). Same
// safety-ceiling framing as that route: maxDuration bounds the platform,
// budget token-bucket bounds cost.
export const maxDuration = 300;

/**
 * R2a (audit finding 1): POST /api/analyses/[id]/retry — owner-initiated
 * server-side regeneration of missing dimensions. Ultra-thin dispatcher:
 * auth/ownership/validation here, rules in RetryMissingDimensionsUseCase.
 * Leaves AnalysisHistory.tsx untouched (R0 stopgap stays until R4 wires it).
 */
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import { verifyResourceOwnership } from '@/lib/services/ownership';
import { SupabaseAuthAdapter } from '@/lib/adapters/SupabaseAuthAdapter';
import {
  RetryMissingDimensionsSchema,
  runRetryWithDefaultDeps,
} from '@/lib/usecases/RetryMissingDimensionsUseCase';
import { ERROR_CODES } from '@/lib/error-codes';

const HTTP_STATUS: Record<string, number> = {
  in_progress: 409,
  cancelled: 409,
  ineligible: 409,
  retry_in_progress: 409,
  budget_exhausted: 429,
  disabled: 503,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Authenticate FIRST (#367 review): unauthenticated callers always get
    // 401, whatever their body looks like.
    const identity = await new SupabaseAuthAdapter().authenticate();
    if (!identity) {
      return NextResponse.json(
        { error: 'Unauthorized', code: ERROR_CODES.AUTH_UNAUTHORIZED },
        { status: 401 }
      );
    }

    // An EMPTY body is part of the contract (= retry every missing
    // dimension). Unparseable JSON is a 400, never silently treated as {}
    // (that used to broaden a malformed request into a full retry).
    const rawBody = await request.text();
    let body: unknown = {};
    if (rawBody.trim().length > 0) {
      try {
        body = JSON.parse(rawBody);
      } catch (parseErr) {
        console.warn('[analyses/[id]/retry] malformed JSON body', { analysisId: id, message: parseErr instanceof Error ? parseErr.message : String(parseErr) });
        return NextResponse.json(
          { error: 'Malformed JSON body', code: ERROR_CODES.INVALID_REQUEST_SCHEMA },
          { status: 400 }
        );
      }
    }
    const parsed = RetryMissingDimensionsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', code: ERROR_CODES.INVALID_REQUEST_SCHEMA },
        { status: 400 }
      );
    }

    const outcome = await runRetryWithDefaultDeps({
      analysisId: id,
      userId: identity.userId,
      requestedDimensions: parsed.data.missingDimensions,
      loadOwnedAnalysis: async (analysisId, userId) => {
        const { data, error } = await verifyResourceOwnership<any>(analysisId, 'analyses',
          'id, user_id, video_id, title, channel_title, analysis_markdown, analysis_payload, validation_report, billing_status'
        );
        // Ownership guard contract: Unauthorized/NotFound/foreign row all map
        // to a generic error so the use case returns not_found_or_forbidden
        // (route answers 404, never 403 — do not leak existence).
        if (error || !data || data.user_id !== userId) return null;
        return data;
      },
    });

    if (outcome.type === 'error' && outcome.message === 'not_found_or_forbidden') {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    if (outcome.type === 'nothing_missing') {
      return NextResponse.json({ status: 'nothing_missing' }, { status: 200 });
    }

    const httpStatus = HTTP_STATUS[outcome.type];
    if (httpStatus) {
      return NextResponse.json({ error: outcome.type }, { status: httpStatus });
    }

    if (outcome.type === 'ok') {
      return NextResponse.json({
        status: outcome.status,
        dimensionsRequested: outcome.dimensionsRequested,
        dimensionCountAfter: outcome.dimensionCountAfter,
      }, { status: 200 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      contexts: { api: { endpoint: '/api/analyses/[id]/retry' } },
    });
    console.error('[analyses/[id]/retry] Unhandled error:', { message, analysisId: id });
    return NextResponse.json(
      { error: 'Retry failed', code: ERROR_CODES.UNHANDLED_EXCEPTION },
      { status: 500 }
    );
  }
}
