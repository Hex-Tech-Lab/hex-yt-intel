/**
 * Phase C shadow mode (2026-10-08): mints the signed per-analysis grant that lets
 * the worker run the Epistemic pipeline in the background. Registry-gated by
 * `analysis.pipeline.epistemic`, default off: a missing key, a registry failure or
 * a signing failure all return undefined, so the legacy pipeline is always the
 * default and a shadow problem can never fail the analysis.
 */
import * as Sentry from '@sentry/nextjs';
import { env } from '@/lib/env';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { EPISTEMIC_PIPELINE_FLAG_KEY, signEpistemicShadow } from '@/lib/config/epistemic-shadow';

/** Returns the grant when the flag is explicitly true, otherwise undefined. */
export async function mintEpistemicShadowGrant(analysisId: string, videoId: string): Promise<{ sig: string; exp: number } | undefined> {
  try {
    const flagRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      [EPISTEMIC_PIPELINE_FLAG_KEY],
      { [EPISTEMIC_PIPELINE_FLAG_KEY]: false }
    );
    if (flagRegistry[EPISTEMIC_PIPELINE_FLAG_KEY] !== true) return undefined;
    return await signEpistemicShadow(env.streamHmacSecret, analysisId);
  } catch (error) {
    console.error('[CreateAnalysisUseCase] epistemic shadow grant skipped', error);
    Sentry.captureException(error, { tags: { component: 'CreateAnalysisUseCase', phase: 'epistemic-shadow' }, extra: { videoId } });
    return undefined;
  }
}
