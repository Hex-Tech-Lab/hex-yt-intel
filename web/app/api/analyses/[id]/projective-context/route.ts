export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { SupabaseAuthAdapter } from '@/lib/adapters/SupabaseAuthAdapter';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { StreamTokenAdapter } from '@/lib/adapters/StreamTokenAdapter';
import { verifyResourceOwnership } from '@/lib/services/ownership';
import { STREAM_BUNDLES } from '@/lib/config/synthesis';
import { PRIOR_PAYLOAD_MAX_BYTES_FALLBACK } from '@/lib/config/prior-payload';
import {
  ProjectiveContextUseCase,
  PROJECTIVE_CONTEXT_REGISTRY_FALLBACK,
} from '@/lib/usecases/ProjectiveContextUseCase';
import { ERROR_CODES } from '@/lib/error-codes';

/**
 * POST /api/analyses/[id]/projective-context (R2b): server-loaded, signed
 * grounded evidence for the projective bundle. Thin dispatcher; the rules live
 * in ProjectiveContextUseCase.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const identity = await new SupabaseAuthAdapter().authenticate();
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized', code: ERROR_CODES.AUTH_UNAUTHORIZED }, { status: 401 });
    }

    const persistence = new SupabasePersistenceAdapter();
    const useCase = new ProjectiveContextUseCase({
      ownsAnalysis: async (analysisId, userId) => {
        const { data, error } = await verifyResourceOwnership<{ user_id: string }>(analysisId, 'analyses', 'id, user_id');
        return !error && !!data && data.user_id === userId;
      },
      findChunks: (analysisId) => persistence.findAnalysisChunks({ analysisId }),
      findJevPlan: (analysisId) => persistence.findJevPlan({ analysisId }),
      findCells: (analysisId) => persistence.findAnalysisCells({ analysisId }),
      resolveSettings: async () => {
        const fallback = {
          'analysis.streamBundles': STREAM_BUNDLES as unknown,
          'analysis.layer2.priorPayloadMaxBytes': PRIOR_PAYLOAD_MAX_BYTES_FALLBACK as unknown,
          ...PROJECTIVE_CONTEXT_REGISTRY_FALLBACK,
        };
        const settings = await SupabaseSettingsAdapter.getRegistrySettings(Object.keys(fallback), fallback);
        return {
          streamBundles: settings['analysis.streamBundles'],
          priorPayloadMaxBytes: settings['analysis.layer2.priorPayloadMaxBytes'],
          retryAfterMs: Number(settings['analysis.layer2.projectiveContextRetryAfterMs']) || PROJECTIVE_CONTEXT_REGISTRY_FALLBACK['analysis.layer2.projectiveContextRetryAfterMs'],
          maxWaitMs: Number(settings['analysis.layer2.projectiveContextMaxWaitMs']) || PROJECTIVE_CONTEXT_REGISTRY_FALLBACK['analysis.layer2.projectiveContextMaxWaitMs'],
        };
      },
      sign: (signParams) => new StreamTokenAdapter().signProjectiveContext(signParams),
    });

    const outcome = await useCase.execute({ analysisId: id, userId: identity.userId });
    switch (outcome.type) {
      case 'not_found':
        return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
      case 'no_projective_bundle':
        return NextResponse.json({ error: 'no_projective_bundle' }, { status: 409 });
      case 'grounded_not_persisted':
        return NextResponse.json(
          { error: 'grounded_not_persisted', retryAfterMs: outcome.retryAfterMs, maxWaitMs: outcome.maxWaitMs },
          { status: 409 }
        );
      case 'ok':
        return NextResponse.json({
          projectiveDimensions: outcome.projectiveDimensions,
          prior_payload: outcome.prior_payload,
          contextSig: outcome.contextSig,
          contextExp: outcome.contextExp,
        });
    }
  } catch (error) {
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/analyses/[id]/projective-context' } } });
    console.error('[analyses/[id]/projective-context] unhandled error:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Projective context failed', code: ERROR_CODES.UNHANDLED_EXCEPTION }, { status: 500 });
  }
}
