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

  /**
   * True when a system-funded (cochran) run that is still live (status
   * <> 'failed': pending, sampling, or completed — values from the
   * comment_sample_runs status check constraint in
   * supabase/migrations/20260724130000_comments_sampling_engine.sql:104)
   * already exists for this analysis. Failed runs are ignored so a past
   * failure does not block a new system retry, matching the partial unique
   * index uq_comment_sample_runs_system_per_analysis
   * (where mode='cochran' and status <> 'failed'). Backs
   * enqueueSystemCommentSampleRun's skip check: the persist-route finalize
   * paths re-fire on every persist retry, and each system run is paid
   * (~$0.003), so a duplicate must never enqueue.
   */
  static async hasSystemSampleRun(analysisId: string): Promise<boolean> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from('comment_sample_runs')
      .select('id')
      .eq('analysis_id', analysisId)
      .eq('mode', 'cochran')
      .neq('status', 'failed')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  }

  /**
   * True when the analysis's persisted payload already carries usable
   * comments (a non-empty array — same definition as
   * aux-status-from-report.ts's hasComments: absent, null, and [] are all
   * "no usable comments"). Backs enqueueSystemCommentSampleRun's skip gate:
   * an analysis that already has comments must not get a system-funded run.
   */
  static async analysisHasUsableComments(analysisId: string, minCount: number): Promise<boolean> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from('analyses')
      .select('analysis_payload')
      .eq('id', analysisId)
      .maybeSingle();
    if (error) throw error;
    const priorComments = (data?.analysis_payload as { comments?: unknown } | null)?.comments;
    return Array.isArray(priorComments) && priorComments.length >= minCount;
  }

  /**
   * Insert a new pending comment_sample_runs row for a system-triggered
   * Tier 3 backfill. Idempotent under concurrency via the partial unique
   * index uq_comment_sample_runs_system_per_analysis (one mode='cochran'
   * row per analysis_id): a duplicate insert — a repeated or concurrent
   * finalize racing this one — resolves to code '23505' and is treated as
   * "already queued", returning { alreadyQueued: true } instead of creating
   * a second paid run or erroring. Any other failure returns null.
   */
  static async insertSystemCommentSampleRun(params: {
    analysisId: string;
    userId: string;
    totalCommentCount: number;
  }): Promise<{ id: string; alreadyQueued: boolean } | null> {
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
        mode: 'cochran',
      })
      .select('id')
      .single();
    if (insertError || !runRow) {
      if (insertError?.code === '23505') {
        // Lost the race: another path already created (and is enqueueing)
        // this analysis's system run. Not an error, nothing more to do.
        console.info('[aux-remediation] system sample run already exists, treating as queued', { analysisId: params.analysisId });
        return { id: '', alreadyQueued: true };
      }
      console.error('[aux-remediation] comment_sample_runs insert failed', { analysisId: params.analysisId, err: insertError?.message });
      return null;
    }
    return { id: runRow.id, alreadyQueued: false };
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
