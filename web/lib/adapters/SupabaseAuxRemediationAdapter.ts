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

  /**
   * Idempotent upsert of one cochran run's classifications into
   * comment_classifications (Comments Dispatch A, 2026-09-30). Conflict
   * target is the uq_comment_classifications_run_comment unique index
   * (comment_sample_run_id + comment_external_id); a retry of the same run
   * re-writes its own rows rather than duplicating them. Rows whose
   * externalId is null still upsert dedupe-safely: comment_external_id is
   * unique per run among null-keyed rows because a single run's payload
   * contains each sampled comment once (consumer dedupes the pool before
   * sampling). Each row is stamped with a per-run cochran batch_id (the
   * column is NOT NULL in the legacy schema). Returns inserted row count.
   */
  static async upsertCommentClassifications(
    sampleRunId: string,
    rows: Array<{
      commentExternalId: string | null;
      commentText: string;
      likeCount: number;
      publishedAt: string;
      author: string;
      sentiment: string;
      commentType: string;
      painPoint: number;
      questionAsked: number;
      intensity: number;
      sentimentConfidence: number;
      lowConfidence: boolean;
      modelUsed: string;
    }>
  ): Promise<number> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from('comment_classifications')
      .upsert(
        rows.map((row) => ({
          comment_sample_run_id: sampleRunId,
          comment_external_id: row.commentExternalId,
          batch_id: `cochran-${sampleRunId}`,
          comment_text: row.commentText,
          like_count: row.likeCount,
          published_at: row.publishedAt,
          sentiment: row.sentiment,
          comment_type: row.commentType,
          pain_point: row.painPoint,
          question_asked: row.questionAsked,
          intensity: row.intensity,
          sentiment_confidence: row.sentimentConfidence,
          low_confidence: row.lowConfidence,
          model_used: row.modelUsed,
        })),
        { onConflict: 'comment_sample_run_id,comment_external_id' }
      )
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  /**
   * Writes the cochran commentInsights + sampled comments into
   * analysis_payload WITHOUT clobbering an existing `comments` key
   * (never-overwrite guard): commentInsights is always (re)written, but
   * `comments` is only set when the prior payload has no comments key.
   * Read-modify-write on the JSONB column, service-role path.
   */
  static async writeCommentsPayload(
    analysisId: string,
    payload: { commentInsights: Record<string, unknown>; comments: Array<Record<string, unknown>> }
  ): Promise<void> {
    const service = getSupabaseServiceClient();
    const { data: row, error: fetchError } = await service
      .from('analyses')
      .select('analysis_payload')
      .eq('id', analysisId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    const prior = (row?.analysis_payload as Record<string, unknown> | null) ?? {};
    const next: Record<string, unknown> = { ...prior, commentInsights: payload.commentInsights };
    // Fill only when there are no usable comments: an absent key, a null
    // (persist has written comments: null historically) or an empty array.
    const priorComments = (prior as { comments?: unknown }).comments;
    if (!Array.isArray(priorComments) || priorComments.length === 0) {
      next.comments = payload.comments;
    }
    const { error: updateError } = await service
      .from('analyses')
      .update({ analysis_payload: next, updated_at: new Date().toISOString() })
      .eq('id', analysisId);
    if (updateError) throw updateError;
  }

  /**
   * 'sampling' heartbeat (Dispatch A §1.4): pending -> sampling. Flips the
   * row out of 'pending' only — completed_at and any already-final status
   * are never touched (a retry racing a completed report can't regress it).
   */
  /** A pending run whose worker enqueue never happened: mark it failed so it is never left orphaned (a later backfill retries it). */
  static async markSampleRunFailed(sampleRunId: string): Promise<void> {
    const service = getSupabaseServiceClient();
    const { error } = await service.from('comment_sample_runs').update({ status: 'failed' }).eq('id', sampleRunId).eq('status', 'pending');
    if (error) console.error('[aux-remediation] markSampleRunFailed failed', { sampleRunId, err: error.message });
  }

  static async markSampleRunSampling(sampleRunId: string, mode?: 'uncapped' | 'cochran'): Promise<void> {
    const service = getSupabaseServiceClient();
    const { error } = await service
      .from('comment_sample_runs')
      .update({ status: 'sampling', ...(mode ? { mode } : {}) })
      .eq('id', sampleRunId)
      .eq('status', 'pending');
    if (error) throw error;
  }

  /** Final status write for a finished run: completed_at + cochran_n. */
  static async finalizeSampleRun(
    sampleRunId: string,
    params: { status: 'completed' | 'failed'; sampledCount: number; mode?: 'uncapped' | 'cochran'; cochranN: number | null }
  ): Promise<void> {
    const service = getSupabaseServiceClient();
    const { error } = await service
      .from('comment_sample_runs')
      .update({
        status: params.status,
        sampled_count: params.sampledCount,
        ...(params.mode ? { mode: params.mode } : {}),
        ...(params.cochranN !== null ? { cochran_n: params.cochranN } : {}),
        completed_at: new Date().toISOString(),
      })
      .eq('id', sampleRunId)
      // #378 review P1: terminal transitions are monotonic -- a delayed or
      // duplicate callback can never turn 'completed' into 'failed' (or back).
      .in('status', ['pending', 'sampling']);
    if (error) throw error;
  }
}
