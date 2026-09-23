/**
 * Stance-relations Settings Registry keys + typed fallbacks.
 * Single source of truth for the persistence-layer tunables used by the
 * relations route, the SupabaseAnalysisPayloadAdapter, and the backfill
 * script -- no hardcoded numeric literals at any call site.
 *
 * relations.persistMaxAttempts     bounded retry attempts for the atomic
 *                                  analysis_payload key-merge (P1-3, PR #322
 *                                  round-2 review: persistence errors were
 *                                  logged-and-ignored with no retry and no
 *                                  zero-row verification).
 * relations.persistRetryBaseDelayMs  base delay for the linear backoff
 *                                  between attempts (delay = base * attempt).
 */
export const RELATIONS_REGISTRY_FALLBACK = {
  'relations.persistMaxAttempts': 3,
  'relations.persistRetryBaseDelayMs': 250,
} as const;

export type RelationsRegistryKey = keyof typeof RELATIONS_REGISTRY_FALLBACK;
