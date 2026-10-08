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
import {
  EPISTEMIC_PERSIST_RETRY_DEFAULT,
  EPISTEMIC_PERSIST_RETRY_KEY,
  EPISTEMIC_PIPELINE_FLAG_KEY,
  parseEpistemicPersistRetry,
  signEpistemicShadow,
  type EpistemicPersistRetry,
} from '@/lib/config/epistemic-shadow';

/**
 * Returns the grant when the flag is explicitly true, otherwise undefined. The
 * persist retry policy comes from the registry; an absent or malformed value
 * falls back to the default (malformed values are reported to Sentry).
 */
export async function mintEpistemicShadowGrant(
  analysisId: string,
  videoId: string,
): Promise<{ sig: string; exp: number; retry: EpistemicPersistRetry } | undefined> {
  try {
    const registry = await SupabaseSettingsAdapter.getRegistrySettings(
      [EPISTEMIC_PIPELINE_FLAG_KEY, EPISTEMIC_PERSIST_RETRY_KEY],
      { [EPISTEMIC_PIPELINE_FLAG_KEY]: false, [EPISTEMIC_PERSIST_RETRY_KEY]: EPISTEMIC_PERSIST_RETRY_DEFAULT }
    );
    if (registry[EPISTEMIC_PIPELINE_FLAG_KEY] !== true) return undefined;
    const rawRetry = registry[EPISTEMIC_PERSIST_RETRY_KEY];
    const retry = parseEpistemicPersistRetry(rawRetry);
    if (!retry) {
      Sentry.captureMessage('epistemic persist retry registry value malformed; using default', {
        level: 'warning',
        tags: { component: 'CreateAnalysisUseCase', phase: 'epistemic-shadow' },
        extra: { videoId, value: rawRetry },
      });
    }
    const effective = retry ?? EPISTEMIC_PERSIST_RETRY_DEFAULT;
    const { sig, exp } = await signEpistemicShadow(env.streamHmacSecret, analysisId, effective);
    return { sig, exp, retry: effective };
  } catch (error) {
    console.error('[CreateAnalysisUseCase] epistemic shadow grant skipped', error);
    Sentry.captureException(error, { tags: { component: 'CreateAnalysisUseCase', phase: 'epistemic-shadow' }, extra: { videoId } });
    return undefined;
  }
}
