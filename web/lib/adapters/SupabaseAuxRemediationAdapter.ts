import { getSupabaseServiceClient } from '@/lib/supabase';

/** Row shape returned by findFailedAnalysesForAuxScan, matching the `analyses` columns aux-remediation.ts needs. */
export interface AuxScanRow {
  id: string;
  video_id: string;
  analysis_markdown: string | null;
  analysis_payload: Record<string, unknown> | null;
  validation_report: unknown;
  billing_status: string;
  user_id: string;
}

/**
 * Supabase access for the aux-remediation harness (channelMeta/comments
 * recovery, see aux-remediation.ts's module doc). Split out to keep this
 * service off `getSupabaseServiceClient()` directly (10X re-audit
 * 2026-08-08, P2.15) -- mirrors SupabaseTranscriptAdapter's standalone,
 * static-method pattern for a small, domain-specific slice of Supabase
 * access rather than growing the general-purpose SupabasePersistenceAdapter
 * with two very bespoke, one-caller queries.
 */
export class SupabaseAuxRemediationAdapter {
  /** Candidate rows for the aux-gap scan: failed analyses, oldest first. */
  static async findFailedAnalysesForAuxScan(limit: number): Promise<AuxScanRow[]> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from('analyses')
      .select('id, video_id, analysis_markdown, analysis_payload, validation_report, billing_status, user_id')
      .eq('billing_status', 'failed')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AuxScanRow[];
  }

  /** Insert a new pending comment_sample_runs row for a system-triggered Tier 3 backfill. Returns its id, or null on failure. */
  static async insertSystemCommentSampleRun(params: {
    analysisId: string;
    userId: string;
    totalCommentCount: number;
  }): Promise<{ id: string } | null> {
    const service = getSupabaseServiceClient();
    const { data: runRow, error: insertError } = await service
      .from('comment_sample_runs')
      .insert({
        analysis_id: params.analysisId,
        user_id: params.userId,
        tier: 3,
        total_comment_count: params.totalCommentCount,
        requested_percent: 100,
        status: 'pending',
      })
      .select('id')
      .single();
    if (insertError || !runRow) {
      console.error('[aux-remediation] comment_sample_runs insert failed', { analysisId: params.analysisId, err: insertError?.message });
      return null;
    }
    return { id: runRow.id };
  }
}
