export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { SupabaseAuthAdapter } from '@/lib/adapters/SupabaseAuthAdapter';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { SettingsModelAdapter } from '@/lib/adapters';
import { verifyResourceOwnership } from '@/lib/services/ownership';
import { STREAM_BUNDLES, assertBundlePartition } from '@/lib/config/synthesis';
import { signStreamTokenV2 } from '@/lib/stream-token';
import { mintCellTokens } from '@/lib/usecases/MintCellTokensUseCase';
import { ERROR_CODES } from '@/lib/error-codes';

const MAX_CELLS_PER_WAVE = 64;

const StreamTokensRequestSchema = z.object({
  cells: z
    .array(z.object({ jevChunkIndex: z.number().int().min(0), chunkIndex: z.number().int().min(1) }).strict())
    .min(1)
    .max(MAX_CELLS_PER_WAVE),
}).strict();

/**
 * POST /api/analyses/[id]/stream-tokens (R3b 2.3.5c). Session-gated: the
 * owner asks for one v2 token per cell it is about to dispatch. Every signed
 * field comes from the stored plan; the body only names cells, and `.strict()`
 * rejects any extra (e.g. forged slice) field. Thin dispatcher: the rules live
 * in MintCellTokensUseCase.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const identity = await new SupabaseAuthAdapter().authenticate();
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized', code: ERROR_CODES.AUTH_UNAUTHORIZED }, { status: 401 });
    }

    const body = StreamTokensRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: 'invalid_request', issues: body.error.flatten() }, { status: 400 });
    }

    const { data: owned, error: ownershipError } = await verifyResourceOwnership<{
      user_id: string;
      video_id: string;
      billing_status: string | null;
      validation_report: { validation_status?: string; status?: string } | null;
    }>(
      id,
      'analyses',
      'id, user_id, video_id, billing_status, validation_report'
    );
    if (ownershipError || !owned || owned.user_id !== identity.userId) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Tokens only for an analysis still being generated: quota is consumed
    // once at job creation, so minting for a settled analysis would let its
    // owner re-run every cell at our expense, unbilled.
    const report = owned.validation_report ?? {};
    const validationStatus = report.validation_status || report.status || 'processing';
    if (validationStatus !== 'processing' || owned.billing_status === 'completed') {
      return NextResponse.json({ error: 'not_processing' }, { status: 409 });
    }

    // Same models and bundle partition the job was dispatched with: the token
    // signs both, so any divergence fails verification at the worker.
    const models = await new SettingsModelAdapter().resolveModels(identity.tier, 'analysis');
    const registry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['analysis.streamBundles'],
      { 'analysis.streamBundles': STREAM_BUNDLES }
    );
    let bundleList: number[][] = STREAM_BUNDLES;
    try {
      const candidate = registry['analysis.streamBundles'] as number[][];
      assertBundlePartition(candidate);
      bundleList = candidate;
    } catch (error) {
      Sentry.captureException(error, { tags: { route: 'analyses-stream-tokens', phase: 'stream-bundles-invariant' } });
    }

    const storedPlan = await new SupabasePersistenceAdapter().findJevPlan({ analysisId: id });
    const outcome = await mintCellTokens(
      { analysisId: id, videoId: owned.video_id, models: [...models], bundleList, storedPlan, cells: body.data.cells },
      signStreamTokenV2,
    );

    switch (outcome.type) {
      case 'ok':
        return NextResponse.json({ tokens: outcome.tokens });
      case 'no_plan':
      case 'plan_k1':
      case 'plan_truncated':
        return NextResponse.json({ error: outcome.type }, { status: 409 });
      case 'invalid_plan':
        Sentry.captureMessage('stored jev_plan failed schema validation', {
          level: 'error',
          tags: { route: 'analyses-stream-tokens' },
          extra: { analysisId: id },
        });
        return NextResponse.json({ error: 'invalid_plan' }, { status: 409 });
      case 'duplicate_cell':
      case 'unknown_cell':
        return NextResponse.json({ error: outcome.type, cell: outcome.cell }, { status: 400 });
      default: {
        const unhandled: never = outcome;
        throw new Error(`unhandled mint outcome: ${JSON.stringify(unhandled)}`);
      }
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'analyses-stream-tokens' }, extra: { analysisId: id } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
