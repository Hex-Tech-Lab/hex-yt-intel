/**
 * TranscriptTimeMarkers (worker) — thin re-export of the shared, isomorphic
 * time-marker annotation in web/lib (R3b Phase 2.6 time-sync), same pattern
 * as TranscriptSlice.ts.
 */

export {
  annotateWithTimeMarkers,
  formatClock,
  hasEstimatedTimes,
  timeAnnotatedReasons,
} from '../../../web/lib/jev/transcript-time-markers';

/**
 * Route B detection (Phase 2.6 Route A/B): the cell that produces the Layer 0
 * classification must read CLEAN transcript text — time markers are factual
 * grounding noise that can corrupt persona/intent classification.
 *
 * Contract: input = the cell's dimension list (v2 requests: verified to match
 * the SIGNED bundle by verifyStreamToken's v2_dimensions_mismatch check;
 * v1 = the legacy unsigned body list, same source every other dimension-driven
 * decision in this route already uses). Output = true iff any dimension's
 * config carries 'classification' in extraFields.
 *
 * Source of truth for which dimensions classify: DIMENSION_CONFIGS in
 * web/lib/config/synthesis.ts (dimension 11, extraFields
 * ['classification','monetizationVerdict']). The worker already imports that
 * module for PromptBuilder (same shared-code pattern as
 * TranscriptTimeMarkers/TranscriptSlice), so we reuse it instead of
 * duplicating the dimension number — no drift risk.
 */
import { DIMENSION_CONFIGS } from '../../../web/lib/config/synthesis';

export function needsCleanTranscript(dimensions: readonly number[]): boolean {
  return dimensions.some((d) => {
    const cfg = DIMENSION_CONFIGS[d];
    return Array.isArray(cfg?.extraFields) && (cfg.extraFields as readonly string[]).includes('classification');
  });
}
