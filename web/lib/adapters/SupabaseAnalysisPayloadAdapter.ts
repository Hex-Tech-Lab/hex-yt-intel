import * as Sentry from '@sentry/nextjs';

import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { RELATIONS_REGISTRY_FALLBACK } from '@/lib/utils/relations-settings';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnalysisPayloadKeyPort, AnalysisPayloadMergeResult } from '@/lib/ports/AnalysisPayloadKeyPort';

/**
 * SupabaseAnalysisPayloadAdapter — AnalysisPayloadKeyPort backed by the
 * `merge_analysis_payload_key` RPC (supabase/migrations/
 * 20260924231500_merge_analysis_payload_key_rpc.sql), which merges a single
 * top-level key into analyses.analysis_payload via jsonb_set, atomically.
 *
 * Persistence contract (PR #322 round-2 P1-3): a persistence failure is
 * retried up to `relations.persistMaxAttempts` (Settings Registry) with a
 * linear backoff of `relations.persistRetryBaseDelayMs * attempt`. After the
 * final attempt the error is captured to Sentry and the adapter resolves
 * `{ persisted: false }` — it NEVER throws into the request path. The
 * calling request still succeeds (degrades to Redis-only caching within its
 * TTL); the zero-row / error outcome is visible to monitoring instead of
 * silently swallowed, and a later request recomputes + re-persists (durable
 * repair). Failures are intentionally not cached as empty results.
 */
export class SupabaseAnalysisPayloadAdapter implements AnalysisPayloadKeyPort {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Merges a single top-level key into analyses.analysis_payload atomically
   * (database-side jsonb_set via the merge_analysis_payload_key RPC).
   * @param analysisId - The analyses row id to merge into.
   * @param key - The top-level analysis_payload key to merge (e.g. 'stance_relations').
   * @param value - The JSON value to merge into that key.
   * @returns {persisted, affectedRows} — never throws into the request path
   * (see the persistence contract in the class doc above).
   */
  async mergePayloadKey(analysisId: string, key: string, value: unknown): Promise<AnalysisPayloadMergeResult> {
    const { maxAttempts, baseDelayMs } = await this.resolveRetrySettings();
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.attemptMergeOnce(analysisId, key, value, attempt);
        if (result) return result;
      } catch (err) {
        lastError = err;
        console.warn(
          `[analysis-payload] merge attempt ${attempt}/${maxAttempts} failed for ${analysisId} (key=${key}):`,
          err instanceof Error ? err.message : String(err)
        );
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
      }
    }
    Sentry.captureException(lastError instanceof Error ? lastError : new Error(String(lastError)), {
      tags: { operation: 'analysis_payload_merge' },
      contexts: { analysisPayload: { analysisId, key, maxAttempts } },
    });
    return { persisted: false, affectedRows: 0 };
  }

  private async resolveRetrySettings(): Promise<{ maxAttempts: number; baseDelayMs: number }> {
    const {
      'relations.persistMaxAttempts': maxAttemptsRaw,
      'relations.persistRetryBaseDelayMs': baseDelayRaw,
    } = await SupabaseSettingsAdapter.getRegistrySettings(
      ['relations.persistMaxAttempts', 'relations.persistRetryBaseDelayMs'],
      RELATIONS_REGISTRY_FALLBACK
    );
    return { maxAttempts: Number(maxAttemptsRaw), baseDelayMs: Number(baseDelayRaw) };
  }

  /**
   * Runs a single RPC merge attempt.
   * @returns the final result, or null when the caller should retry (thrown
   * errors propagate to mergePayloadKey's catch/retry loop).
   */
  private async attemptMergeOnce(
    analysisId: string,
    key: string,
    value: unknown,
    attempt: number
  ): Promise<AnalysisPayloadMergeResult | null> {
    const { data, error } = await this.client.rpc('merge_analysis_payload_key', {
      p_id: analysisId,
      p_key: key,
      p_value: value,
    });
    if (error) throw new Error(error.message);
    const affectedRows = typeof data === 'number' ? data : 0;
    if (affectedRows === 0) {
      // Zero-row update: the RPC ran but matched no row the caller may
      // write. Surface it rather than pretending the write landed.
      console.error('[analysis-payload] merge matched 0 rows', { analysisId, key, attempt });
      return { persisted: false, affectedRows: 0 };
    }
    return { persisted: true, affectedRows };
  }
}
