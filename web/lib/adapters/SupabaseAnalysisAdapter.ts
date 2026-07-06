import { getSupabaseServiceClient } from '@/lib/supabase';
import { parseUcisDimensions } from '@/lib/parse-ucis-dimensions';
import { MIN_USABLE_DIMENSIONS } from '@/lib/config/synthesis';
import * as Sentry from '@sentry/nextjs';
import type {
  CachedAnalysis,
  AnalysisStub,
  ValidationReportInput,
  HistoryOverviewItem,
} from '@/lib/ports';
import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';
import { isPersistedValidationReport } from '@/lib/types/validation-report';
import { mapHistoryOverviewRow, type RawHistoryOverviewRow } from '@/lib/utils/history-overview';

export class SupabaseAnalysisAdapter {
  static async findCachedAnalysis(params: {
    userId: string;
    videoId: string;
  }): Promise<CachedAnalysis | null> {
    const service = getSupabaseServiceClient();
    const { data: existing } = await service
      .from('analyses')
      .select('id, video_id, title, analysis_markdown, analysis_payload, created_at, validation_report, billing_status')
      .eq('video_id', params.videoId)
      .eq('user_id', params.userId)
      .neq('billing_status', 'processing') // Skip active jobs
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing) return null;

    if (existing.analysis_payload && typeof existing.analysis_payload === 'object' && Object.keys(existing.analysis_payload).length > 0) {
      const payload = existing.analysis_payload as Record<string, unknown>;
      
      const raw = Array.isArray(payload.dimensions) ? payload.dimensions : Object.values(payload.dimensions ?? {});
      const dimensions = raw.reduce<Record<string, unknown>>((acc, d: any) => {
        if (d && typeof d.number === 'number') acc[d.number] = d;
        return acc;
      }, {});

      const res = {
        id: existing.id,
        videoId: existing.video_id,
        title: existing.title,
        analysisMarkdown: existing.analysis_markdown ?? JSON.stringify(existing.analysis_payload),
        createdAt: existing.created_at,
        dimensions,
        cachedReport: (existing.validation_report ?? {}) as {
          metadata?: AnalysisJobMetadata;
          persona?: string;
          timezone?: string;
        },
        analysisPayload: existing.analysis_payload as any,
      };

      if (res.cachedReport.metadata && !res.cachedReport.metadata.videoId) {
        res.cachedReport.metadata.videoId = existing.video_id;
      }
      
      return res;
    }

    if (!existing.analysis_markdown) return null;

    const dimensions = parseUcisDimensions(existing.analysis_markdown);
    const dimensionCount = Object.keys(dimensions).length;

    if (dimensionCount < MIN_USABLE_DIMENSIONS) {
      console.warn(
        `[PersistenceAdapter] Cache for ${existing.id} has ${dimensionCount} dimensions (<${MIN_USABLE_DIMENSIONS}) — treating as miss.`
      );
      return null;
    }

    const cachedReport = (existing.validation_report ?? {}) as {
      metadata?: AnalysisJobMetadata;
      persona?: string;
      timezone?: string;
    };

    if (cachedReport.metadata && !cachedReport.metadata.videoId) {
      cachedReport.metadata.videoId = existing.video_id;
    }

    return {
      id: existing.id,
      videoId: existing.video_id,
      title: existing.title,
      analysisMarkdown: existing.analysis_markdown,
      createdAt: existing.created_at,
      dimensions,
      cachedReport,
    };
  }

  static async upsertProcessingStub(params: {
    videoId: string;
    userId: string;
    title: string;
    validationReport: ValidationReportInput;
  }): Promise<AnalysisStub> {
    const service = getSupabaseServiceClient();
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // 1. Look for an active processing stub created within the last 15 minutes
    const { data: activeStub } = await service
      .from('analyses')
      .select('id')
      .eq('video_id', params.videoId)
      .eq('user_id', params.userId)
      .eq('billing_status', 'processing')
      .gte('created_at', fifteenMinutesAgo)
      .maybeSingle();

    if (activeStub) {
      // Update the existing active processing stub in-place (second call metadata update)
      const { data: updated, error: updateError } = await service
        .from('analyses')
        .update({
          title: params.title,
          channel_title: params.validationReport.metadata?.channelTitle || '',
          validation_report: {
            status: params.validationReport.status,
            transcript_available: params.validationReport.transcriptAvailable,
            analysis_type: params.validationReport.analysisType,
            stale_after: params.validationReport.staleAfter,
            metadata: params.validationReport.metadata,
            persona: params.validationReport.persona,
            timezone: params.validationReport.timezone,
          },
        })
        .eq('id', activeStub.id)
        .select('id')
        .single();

      if (updateError || !updated?.id) {
        Sentry.captureException(updateError ?? new Error('update processing stub returned no row'), {
          tags: { operation: 'analysis-update-processing-stub' },
          extra: { videoId: params.videoId, userId: params.userId, stubId: activeStub.id },
        });
        throw updateError ?? new Error('update processing stub returned no row');
      }

      console.log('[SupabaseAnalysisAdapter] row_persisted', {
        event: 'upsert_stub_update_complete',
        stubId: updated.id,
        videoId: params.videoId,
        userId: params.userId,
        timestamp: new Date().toISOString(),
      });

      return { id: updated.id as string };
    }

    // 2. Otherwise, this is a fresh run (first call). Count quota and insert stub atomically.
    const { data: rpcData, error: rpcError } = await service
      .rpc('reserve_analysis_quota', {
        p_user_id: params.userId,
        p_video_id: params.videoId,
        p_title: params.title,
        p_validation_report: {
          status: params.validationReport.status,
          transcript_available: params.validationReport.transcriptAvailable,
          analysis_type: params.validationReport.analysisType,
          stale_after: params.validationReport.staleAfter,
          metadata: params.validationReport.metadata,
          persona: params.validationReport.persona,
          timezone: params.validationReport.timezone,
        },
      });

    if (rpcError || !rpcData) {
      const errMsg = rpcError?.message || 'Failed to reserve analysis quota';
      Sentry.captureException(rpcError ?? new Error(errMsg), {
        tags: { operation: 'analysis-prepare-rpc' },
        extra: { videoId: params.videoId, userId: params.userId },
      });
      throw new Error(errMsg);
    }

    console.log('[SupabaseAnalysisAdapter] row_persisted', {
      event: 'upsert_stub_create_complete',
      stubId: rpcData as string,
      videoId: params.videoId,
      userId: params.userId,
      timestamp: new Date().toISOString(),
    });

    return { id: rpcData as string };
  }

  // Retry / error-state propagation is intentionally NOT handled here: this
  // adapter is the persistence sink (single DB write). Retry with backoff and
  // failure-state settling are owned by the caller layer — the persist route's
  // `retryWithBackoff` and the Worker's atomic-persist — so the responsibility
  // lives once, at the right seam (SoC), not duplicated in every adapter.
  static async persistAnalysis(params: {
    analysisId: string;
    analysisPayload: UCISPayloadV2 | null;
    analysisMarkdown: string;
    validationPassed: boolean;
  }): Promise<void> {
    const service = getSupabaseServiceClient();
    const { error } = await service
      .from('analyses')
      .update({
        analysis_payload: params.analysisPayload as Record<string, unknown> | null,
        analysis_markdown: params.analysisMarkdown,
        validation_passed: params.validationPassed,
        billing_status: 'completed',
      })
      .eq('id', params.analysisId);

    if (error) {
      Sentry.captureException(error, {
        tags: { operation: 'analysis-persist' },
        extra: { analysisId: params.analysisId },
      });
      throw error;
    }

    console.log('[SupabaseAnalysisAdapter] row_persisted', {
      event: 'persist_analysis_complete',
      analysisId: params.analysisId,
      validationPassed: params.validationPassed,
      timestamp: new Date().toISOString(),
    });
  }

  static async getUserHistory(params: { userId: string }): Promise<Array<{
    id: string;
    videoId: string;
    title: string;
    createdAt: string;
    status: 'completed' | 'processing' | 'incomplete';
  }>> {
    try {
      const service = getSupabaseServiceClient();
      const { data: analyses, error } = await service
        .from('analyses')
        .select('id, video_id, title, created_at, validation_passed, validation_report, billing_status')
        .eq('user_id', params.userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[SupabaseAnalysisAdapter] getUserHistory failed:', error);
        throw error;
      }

      return (analyses || []).map((analysis: any) => ({
        id: analysis.id,
        videoId: analysis.video_id,
        title: analysis.title || 'Untitled Analysis',
        createdAt: analysis.created_at,
        status: (() => {
          const statusMap: Record<string, 'completed' | 'processing' | 'incomplete'> = {
            completed: 'completed',
            done: 'completed',
            processing: 'processing',
          };
          if (analysis.billing_status === 'completed' || analysis.validation_passed) return 'completed';
          return statusMap[analysis.validation_report?.status] ?? 'incomplete';
        })(),
      }));
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getUserHistory' },
        extra: { userId: params.userId },
      });
      throw error;
    }
  }

  /**
   * Video-centric history overview. The base-video grouping, winner selection,
   * dimension extraction and rollup status all live in the
   * `get_user_history_overview` Postgres function (one round trip, no markdown
   * shipped to the app); this method only coerces the rows to the domain shape.
   */
  static async getUserHistoryOverview(params: { userId: string }): Promise<HistoryOverviewItem[]> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service.rpc('get_user_history_overview', {
        p_user_id: params.userId,
      });

      if (error) {
        console.error('[SupabaseAnalysisAdapter] getUserHistoryOverview failed:', error);
        throw error;
      }

      return ((data as RawHistoryOverviewRow[]) || []).map(mapHistoryOverviewRow);
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getUserHistoryOverview' },
        extra: { userId: params.userId },
      });
      throw error;
    }
  }

  static async findAnalysisById(params: {
    userId: string;
    analysisId: string;
  }): Promise<{
    id: string;
    title: string;
    videoId: string;
    analysisMarkdown: string;
    createdAt: string;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('id, title, video_id, analysis_markdown, created_at')
        .eq('id', params.analysisId)
        .eq('user_id', params.userId)
        .maybeSingle();

      const handlerMap = {
        ERROR: () => { throw error; },
        NO_DATA: () => null as null,
        SUCCESS: () => ({
          id: data!.id,
          title: data!.title || 'Untitled',
          videoId: data!.video_id,
          analysisMarkdown: data!.analysis_markdown || '',
          createdAt: data!.created_at,
        }),
      } as const;

      if (error) handlerMap.ERROR();
      if (!data) return handlerMap.NO_DATA();
      return handlerMap.SUCCESS();
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAnalysisById' },
        extra: { userId: params.userId, analysisId: params.analysisId },
      });
      throw error;
    }
  }

  static async findAnalysisForPersist(params: {
    analysisId: string;
    videoId: string;
  }): Promise<{
    id: string;
    userId: string;
    title: string;
    validationReport: ValidationReportInput | unknown;
    createdAt: string;
    channelTitle?: string | null;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('id, user_id, title, validation_report, created_at, channel_title')
        .eq('id', params.analysisId)
        .eq('video_id', params.videoId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseAnalysisAdapter] findAnalysisForPersist failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        userId: data.user_id,
        title: data.title,
        validationReport: data.validation_report,
        createdAt: data.created_at,
        channelTitle: data.channel_title,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAnalysisForPersist' },
        extra: { analysisId: params.analysisId, videoId: params.videoId },
      });
      throw error;
    }
  }

  static async getAnalysisGrounding(params: {
    analysisId: string;
  }): Promise<{
    title: string;
    channelTitle: string | null;
    description: string | null;
    analysisMarkdown: string | null;
    status: string;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('title, channel_title, analysis_markdown, validation_report')
        .eq('id', params.analysisId)
        .maybeSingle();

      const handlerMap = {
        ERROR: () => { throw error; },
        NO_DATA: () => null as null,
        SUCCESS: () => ({
          title: data!.title || '',
          channelTitle: data!.channel_title || null,
          description: isPersistedValidationReport(data!.validation_report) ? data!.validation_report.metadata?.description || null : null,
          analysisMarkdown: data!.analysis_markdown || null,
          status: isPersistedValidationReport(data!.validation_report) ? data!.validation_report.status || 'incomplete' : 'incomplete',
        }),
      } as const;

      if (error) handlerMap.ERROR();
      if (!data) return handlerMap.NO_DATA();
      return handlerMap.SUCCESS();
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getAnalysisGrounding' },
        extra: { analysisId: params.analysisId },
      });
      throw error;
    }
  }

  static async findAnalysisByShareToken(token: string): Promise<{
    id: string;
    title: string;
    channelTitle: string | null;
    analysisMarkdown: string | null;
    sharedExpiresAt: string | null;
    createdAt: string;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('id, title, channel_title, analysis_markdown, shared_expires_at, created_at')
        .eq('shared_token', token)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseAnalysisAdapter] findAnalysisByShareToken failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        title: data.title || 'Untitled',
        channelTitle: data.channel_title,
        analysisMarkdown: data.analysis_markdown || null,
        sharedExpiresAt: data.shared_expires_at,
        createdAt: data.created_at,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAnalysisByShareToken' },
        extra: { token: '[REDACTED]' },
      });
      throw error;
    }
  }

  static async updateValidationReport(params: {
    analysisId: string;
    report: any;
    passed: boolean;
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error } = await service
        .from('analyses')
        .update({
          validation_report: params.report,
          validation_passed: params.passed,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.analysisId);

      if (error) {
        console.error('[SupabaseAnalysisAdapter] updateValidationReport failed:', error.message);
        throw error;
      }
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'updateValidationReport' },
        extra: { analysisId: params.analysisId },
      });
      throw error;
    }
  }

  static async verifyOwnership(params: {
    analysisId: string;
    userId: string;
    select?: string;
  }): Promise<any | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select(params.select || '*')
        .eq('id', params.analysisId)
        .eq('user_id', params.userId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseAnalysisAdapter] verifyOwnership failed:', error.message);
        throw error;
      }
      return data;
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'verifyOwnership' },
        extra: { analysisId: params.analysisId, userId: params.userId },
      });
      throw error;
    }
  }

  /**
   * Atomically bump `viewed_count` for one owned analysis row (surfaced as
   * "Views" in the history overview). Delegates to the `increment_analysis_view`
   * RPC so the increment is a single `col = col + 1` UPDATE — a read-modify-write
   * would race concurrent opens and lose counts. Best-effort: a failed view
   * bump must never break rendering the analysis, so the caller fires this
   * without awaiting and this method swallows/reports rather than rethrows.
   */
  static async incrementViewCount(params: { analysisId: string; userId: string }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error } = await service.rpc('increment_analysis_view', {
        p_analysis_id: params.analysisId,
        p_user_id: params.userId,
      });
      if (error) throw error;
    } catch (error: unknown) {
      // Non-fatal: log for observability but do not surface to the read path.
      console.warn('[SupabaseAnalysisAdapter] incrementViewCount failed:', error instanceof Error ? error.message : String(error));
      Sentry.captureException(error, {
        tags: { method: 'incrementViewCount' },
        extra: { analysisId: params.analysisId, userId: params.userId },
      });
    }
  }
}
