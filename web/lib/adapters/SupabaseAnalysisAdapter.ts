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
import type { StoredExecutiveDigest } from '@/lib/ports/ExecutiveDigestPorts';
import { mapHistoryOverviewRow, type RawHistoryOverviewRow } from '@/lib/utils/history-overview';
import { stripArchivedVideoIdSuffix } from '@/lib/utils/archived-video-id';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';
import type { ClientPlatform } from '@/lib/utils/client-platform';

const MAX_GROUNDING_PAYLOAD_BYTES = 100_000;

/** Prefer stored markdown; fall back to reconstructing from analysis_payload (mirrors /api/analyses/[id]).
 *  Chat grounding and the Synthesis Console must read the same effective content — if this falls out of
 *  sync with that route's safeReconstructMarkdown, chat will refuse on analyses the Console renders fine. */
function reconstructGroundingMarkdown(analysisMarkdown: string | null, analysisPayload: unknown): string {
  if (analysisMarkdown) return analysisMarkdown;
  if (!analysisPayload || typeof analysisPayload !== 'object') return '';
  try {
    const payloadSize = new TextEncoder().encode(JSON.stringify(analysisPayload)).length;
    if (payloadSize > MAX_GROUNDING_PAYLOAD_BYTES) {
      console.warn('[getAnalysisGrounding] Payload too large for reconstruction, skipping:', payloadSize);
      return '';
    }
    return reconstructMarkdown(analysisPayload as Partial<UCISPayloadV2>);
  } catch {
    console.warn('[getAnalysisGrounding] markdown reconstruction failed, returning empty');
    return '';
  }
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Renders the transcript's timed segments as "[mm:ss] text" lines so chat can
 * answer "what was said around min. X" and quote verbatim with a timestamp,
 * instead of only having an undifferentiated text blob. Returns '' (falls
 * back to the flat `content` column) when segments are missing/malformed --
 * older rows and text-only transcripts (see upsertTranscript callers) never
 * had timed segments.
 */
function formatTranscriptWithTimestamps(rawSegments: unknown): string {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return '';
  const lines: string[] = [];
  for (const seg of rawSegments) {
    if (!seg || typeof seg !== 'object') continue;
    const { start, text } = seg as { start?: unknown; text?: unknown };
    if (typeof start !== 'number' || typeof text !== 'string' || !text.trim()) continue;
    lines.push(`[${formatTimestamp(start)}] ${text.trim()}`);
  }
  return lines.join('\n');
}

interface AnalysisRecord {
  id: string;
  video_id: string;
  title: string | null;
  created_at: string;
  validation_passed: boolean | null;
  validation_report: { status?: string } | null;
  billing_status: string | null;
}

/**
 * Supabase-backed analysis storage adapter implementing AnalysisPersistencePort.
 * Provides cache lookups, stub creation/updates, result persistence, history retrieval,
 * ownership verification, digest management, and analysis reaping operations.
 * All operations include Sentry error tracking and console logging for debugging.
 */
export class SupabaseAnalysisAdapter {
  /** Retrieve cached analysis for user/video, extracting dimensions from markdown or payload. */
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

  /** Create or reuse a processing stub for an in-flight analysis, idempotent within 15 minutes. */
  static async upsertProcessingStub(params: {
    videoId: string;
    userId: string;
    title: string;
    transcriptHash?: string;
    clientPlatform?: ClientPlatform | null;
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
          // Only overwrite on an actual signal; a retry/refresh call with no UA
          // (or an unparseable one) must not clobber the platform recorded on
          // the original request.
          ...(params.clientPlatform ? { client_platform: params.clientPlatform } : {}),
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

    const analysisId = rpcData as string;

    // Store transcript hash (ADR 006: cache key based on input transcript) and the
    // UA-derived client platform (cosmetic device signal, RCA 2026-07-24) if
    // present. `reserve_analysis_quota` doesn't accept either column, so a
    // single follow-up update covers both fields the RPC can't set directly.
    const followUpUpdate: Record<string, string> = {};
    if (params.transcriptHash) followUpUpdate.transcript_hash = params.transcriptHash;
    if (params.clientPlatform) followUpUpdate.client_platform = params.clientPlatform;

    if (Object.keys(followUpUpdate).length > 0) {
      const { error: followUpError } = await service
        .from('analyses')
        .update(followUpUpdate)
        .eq('id', analysisId);

      if (followUpError) {
        Sentry.captureException(followUpError, {
          tags: { operation: 'analysis-persist-stub-followup' },
          extra: { analysisId, videoId: params.videoId },
        });
        console.warn('[SupabaseAnalysisAdapter] Failed to store transcript hash / client platform:', followUpError.message);
      }
    }

    console.log('[SupabaseAnalysisAdapter] row_persisted', {
      event: 'upsert_stub_create_complete',
      stubId: analysisId,
      videoId: params.videoId,
      userId: params.userId,
      timestamp: new Date().toISOString(),
    });

    return { id: analysisId };
  }

  // Retry / error-state propagation is intentionally NOT handled here: this
  // adapter is the persistence sink (single DB write). Retry with backoff and
  // failure-state settling are owned by the caller layer — the persist route's
  // `retryWithBackoff` and the Worker's atomic-persist — so the responsibility
  // lives once, at the right seam (SoC), not duplicated in every adapter.
  //
  /** DEPRECATED: Use updateAnalysisResult instead. Persists analysis markdown and payload (legacy). */
  // DEPRECATED: This method is superseded by updateAnalysisResult which properly
  // handles billing_status from the validation report. This method is kept for
  // backward compatibility but should NOT be used for new code paths.
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
        // NOTE: Do NOT override billing_status here; it should be set via updateAnalysisResult
        // with proper validation report data. Legacy method kept for backward compat only.
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

  /** Fetch full user analysis history with complete metadata and validation details. */
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

      return (analyses || []).map((analysis: AnalysisRecord) => ({
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
          // RCA (2026-07-23): 'chargeable'/'charged' were never valid DB values
          // (CHECK constraint only allows processing|completed|failed) -- this
          // branch was dead code that could never match a real row. The
          // validation_passed fallback below is likely why this masked the
          // constraint-violation bug for a while: billing_status writes were
          // silently failing, but validation_passed sometimes still got set.
          if (analysis.billing_status === 'completed' || !!analysis.validation_passed) return 'completed';
          const reportStatus = analysis.validation_report?.status;
          if (!reportStatus) return 'incomplete';
          return statusMap[reportStatus] ?? 'incomplete';
        })(),
      }));
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'findAnalysisById' },
        extra: { userId: params.userId, analysisId: params.analysisId },
      });
      throw error;
    }
  }

  /**
   * Fetch analysis metadata for persistence operations.
   * Used by persist endpoint to verify analysis ownership and retrieve report.
   * @param params - Query parameters: analysisId, videoId, and optional transcript inclusion
   * @returns Analysis metadata or null if not found
   */
  static async findAnalysisForPersist(params: {
    analysisId: string;
    videoId: string;
    includeTranscript?: boolean;
  }): Promise<{
    id: string;
    userId: string;
    title: string;
    transcriptHash?: string | null;
    transcript?: string | null;
    validationReport: ValidationReportInput | unknown;
    analysisPayload?: unknown;
    createdAt: string;
    channelTitle?: string | null;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const columns = params.includeTranscript
        ? 'id, user_id, title, transcript_hash, transcript, validation_report, analysis_payload, created_at, channel_title'
        : 'id, user_id, title, transcript_hash, validation_report, analysis_payload, created_at, channel_title';
      const { data, error } = await service
        .from('analyses')
        .select(columns)
        .eq('id', params.analysisId)
        .eq('video_id', params.videoId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseAnalysisAdapter] findAnalysisForPersist failed:', error.message);
        throw error;
      }
      if (!data) return null;

      const row = data as any;
      return {
        id: row.id,
        userId: row.user_id,
        title: row.title,
        transcriptHash: row.transcript_hash,
        transcript: row.transcript,
        validationReport: row.validation_report,
        analysisPayload: row.analysis_payload,
        createdAt: row.created_at,
        channelTitle: row.channel_title,
      };
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'findAnalysisForPersist' },
        extra: { analysisId: params.analysisId, videoId: params.videoId },
      });
      throw error;
    }
  }

  static async getAnalysisGrounding(params: {
    analysisId: string;
    userId?: string;
  }): Promise<{
    title: string;
    channelTitle: string | null;
    description: string | null;
    analysisMarkdown: string | null;
    status: string;
    transcript?: string | null;
    videoMetadata?: Record<string, unknown> | null;
    channelMetadata?: Record<string, unknown> | null;
    executiveDigest?: StoredExecutiveDigest | null;
    comments?: Array<{ author: string; text: string; publishedAt: string; likeCount: number }> | null;
    highlights?: Array<{ idx: number; start: number; end: number; label: string; takeawayIdx: number | null; verbatimExcerpt: string | null }> | null;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      let query = service
        .from('analyses')
        // RCA (2026-07-23): executive_digest (Dimension 0 -- snapshot/overview/
        // takeaways/detailed-summary) was never selected here, so chat grounding
        // only ever saw dimensions 1-11 despite the user-facing product surfacing
        // dim-0 prominently. Selected + surfaced below.
        .select('title, channel_title, analysis_markdown, analysis_payload, validation_report, billing_status, video_id, executive_digest')
        .eq('id', params.analysisId);
      if (params.userId) {
        query = query.eq('user_id', params.userId);
      }
      const { data, error } = await query.maybeSingle();

      if (error) throw error;
      if (!data) return null;

      let transcript: string | null = null;

      // Strip the reaper's '_archived_<ts>' suffix before the transcripts lookup --
      // transcripts are stored under the clean video_id (see upsertTranscript /
      // web/app/api/analyses/persist/route.ts), so an archived analysis row would
      // otherwise silently miss its own transcript on every grounding fetch.
      const cleanVideoId = stripArchivedVideoIdSuffix(data.video_id) ?? null;
      if (cleanVideoId) {
        const { data: txData } = await service
          .from('transcripts')
          .select('content, segments')
          .eq('video_id', cleanVideoId)
          .maybeSingle();
        const rawSegments = (txData as { segments?: unknown } | null)?.segments;
        transcript = formatTranscriptWithTimestamps(rawSegments) || txData?.content || null;
      }

      // Compute frontend-visible status (matches analysis endpoint logic)
      const report = (data!.validation_report as any) || {};
      const validationStatus = report.validation_status || report.status || 'processing';
      const dimensionStatus = report.dimension_status;
      const hasDimensions = Array.isArray(dimensionStatus) && dimensionStatus.some((d: any) => d?.status === 'done');

      let computedStatus = 'incomplete';
      if (validationStatus === 'done' || data!.billing_status === 'completed') {
        computedStatus = 'complete';
      } else if (validationStatus === 'error' || validationStatus === 'failed') {
        computedStatus = 'error';
      } else if (validationStatus === 'partial' || hasDimensions) {
        computedStatus = 'partial';
      }

      const payload = (data as any).analysis_payload as Record<string, unknown> | null;

      const reportDescription = isPersistedValidationReport(data!.validation_report)
        ? data!.validation_report.metadata?.description || null
        : null;

      const payloadDescription =
        (payload && typeof (payload as any).videoMetadata?.description === 'string' ? (payload as any).videoMetadata.description : null) ||
        (payload && typeof (payload as any).metadata?.description === 'string' ? (payload as any).metadata.description : null) ||
        (payload && typeof (payload as any).description === 'string' ? (payload as any).description : null);

      const resolvedVideoMetadata =
        (report.metadata as Record<string, unknown>) ||
        (payload?.videoMetadata as Record<string, unknown>) ||
        (payload?.metadata as Record<string, unknown>) ||
        null;

      const resolvedChannelMetadata =
        (report.channelMeta as Record<string, unknown>) ||
        (payload?.channelMeta as Record<string, unknown>) ||
        (payload?.channelMetadata as Record<string, unknown>) ||
        null;

      const resolvedComments =
        (Array.isArray(report.comments) ? report.comments : null) ||
        (payload && Array.isArray((payload as any).comments) ? (payload as any).comments : null) ||
        null;

      // Highlights reel data (§2.B.3, 2026-08-21): timestamped key moments
      // and takeaway mappings from analysis_highlights. Fetched so chat
      // grounding can annotate which takeaway each highlight backs and display
      // verbatim transcript excerpts instead of LLM-synthesized labels.
      type HighlightRow = {
        idx: number;
        start_seconds: number;
        end_seconds: number;
        label: string;
        takeaway_idx: number | null;
        verbatim_excerpt: string | null;
      };
      let highlights: Array<{ idx: number; start: number; end: number; label: string; takeawayIdx: number | null; verbatimExcerpt: string | null }> | null = null;
      try {
        const { data: hlData, error: hlQueryError } = await service
          .from('analysis_highlights')
          .select('idx, start_seconds, end_seconds, label, takeaway_idx, verbatim_excerpt')
          .eq('analysis_id', params.analysisId)
          .order('idx', { ascending: true });
        if (hlQueryError) throw hlQueryError;
        if (hlData && hlData.length > 0) {
          highlights = (hlData as HighlightRow[]).map((row) => ({
            idx: row.idx,
            start: row.start_seconds,
            end: row.end_seconds,
            label: row.label,
            takeawayIdx: row.takeaway_idx ?? null,
            verbatimExcerpt: row.verbatim_excerpt ?? null,
          }));
        }
      } catch (hlError: unknown) {
        // Highlights are best-effort — a read failure on analysis_highlights
        // must never abort the entire grounding fetch (the digest + transcript
        // + dimensions are the core source; highlights are supplementary).
        // PostgREST resolves { data, error }, it does NOT reject — so without
        // the explicit error check above, a query failure would silently drop
        // the HIGHLIGHTS REEL section with zero Sentry visibility.
        console.warn('[SupabaseAnalysisAdapter] analysis_highlights query failed:', hlError instanceof Error ? hlError.message : String(hlError));
        Sentry.captureException(hlError, { tags: { method: 'getAnalysisGrounding.highlights' }, extra: { analysisId: params.analysisId } });
      }

      const rawDigest = (data as any).executive_digest;
      const hasDigestContent = rawDigest && typeof rawDigest === 'object'
        && (typeof rawDigest.snapshot === 'string' && rawDigest.snapshot.length > 0
          || typeof rawDigest.overview === 'string' && rawDigest.overview.length > 0
          || Array.isArray(rawDigest.takeaways) && rawDigest.takeaways.length > 0);

      return {
        title: data!.title || '',
        channelTitle: data!.channel_title || null,
        description: reportDescription || payloadDescription || null,
        analysisMarkdown: reconstructGroundingMarkdown(data!.analysis_markdown, payload),
        status: computedStatus,
        transcript,
        videoMetadata: resolvedVideoMetadata,
        channelMetadata: resolvedChannelMetadata,
        executiveDigest: hasDigestContent ? (rawDigest as StoredExecutiveDigest) : null,
        comments: resolvedComments,
        highlights,
      };
    } catch (error: unknown) {
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
    videoId: string | null;
    videoDurationSeconds: number | null;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('id, title, channel_title, analysis_markdown, shared_expires_at, created_at, video_id, analysis_payload')
        .eq('shared_token', token)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseAnalysisAdapter] findAnalysisByShareToken failed:', error.message);
        throw error;
      }
      if (!data) return null;

      const payload = (data as any).analysis_payload as Record<string, unknown> | null;
      const rawDuration =
        (payload && typeof (payload as any).metadata === 'object' && (payload as any).metadata?.duration) ||
        (payload && (payload as any).videoMetadata && typeof (payload as any).videoMetadata === 'object' && (payload as any).videoMetadata.duration) ||
        null;
      const videoDurationSeconds = typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration : null;

      return {
        id: data.id,
        title: data.title || 'Untitled',
        channelTitle: data.channel_title,
        analysisMarkdown: data.analysis_markdown || null,
        sharedExpiresAt: data.shared_expires_at,
        createdAt: data.created_at,
        videoId: stripArchivedVideoIdSuffix(data.video_id) ?? null,
        videoDurationSeconds,
      };
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'findAnalysisByShareToken' },
        extra: { token: '[REDACTED]' },
      });
      throw error;
    }
  }

  /**
   * Highlights rows for one already-resolved analysisId. Service-role read
   * explicitly scoped to a single row's foreign key (never a table scan) —
   * the caller (public share page) must have already validated the
   * analysisId via findAnalysisByShareToken before calling this, since
   * analysis_highlights' RLS policy is owner-only and grants nothing to
   * anon/authenticated (migrations 20260813222218 / ...222233).
   */
  static async findHighlightsForAnalysis(analysisId: string): Promise<Array<{
    idx: number;
    start: number;
    end: number;
    label: string;
    takeawayIdx: number | null;
    verbatimExcerpt: string | null;
  }>> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analysis_highlights')
        .select('idx, start_seconds, end_seconds, label, verbatim_excerpt, takeaway_idx')
        .eq('analysis_id', analysisId)
        .order('idx', { ascending: true });

      if (error) {
        console.error('[SupabaseAnalysisAdapter] findHighlightsForAnalysis failed:', error.message);
        throw error;
      }

      return (data ?? []).map((h) => ({
        idx: h.idx,
        start: h.start_seconds,
        end: h.end_seconds,
        label: h.label,
        verbatimExcerpt: h.verbatim_excerpt ?? null,
        takeawayIdx: h.takeaway_idx ?? null,
      }));
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'findHighlightsForAnalysis' },
        extra: { analysisId },
      });
      throw error;
    }
  }

  static async verifyAnalysisExists(analysisId: string): Promise<boolean> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('id')
        .eq('id', analysisId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseAnalysisAdapter] verifyAnalysisExists failed:', error.message);
        throw error;
      }
      return !!data;
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'verifyAnalysisExists' },
        extra: { analysisId },
      });
      throw error;
    }
  }

  static async getAnalysisOwner(analysisId: string): Promise<string | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('user_id')
        .eq('id', analysisId)
        .maybeSingle();

      if (error) throw error;
      return (data as { user_id: string } | null)?.user_id ?? null;
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'getAnalysisOwner' },
        extra: { analysisId },
      });
      throw error;
    }
  }

  /**
   * Fetch analysis markdown directly, bypassing user_id ownership check.
   * Internal S2S use only (e.g. QStash embedding poll webhook).
   */
  static async getAnalysisMarkdownInternal(analysisId: string): Promise<string | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('analysis_markdown')
        .eq('id', analysisId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseAnalysisAdapter] getAnalysisMarkdownInternal failed:', error.message);
        throw error;
      }
      return data?.analysis_markdown || null;
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'getAnalysisMarkdownInternal' },
        extra: { analysisId },
      });
      throw error;
    }
  }

  static async updateValidationReport(params: {
    analysisId: string;
    report: any;
    passed?: boolean;
    /** When true, only the report is written — validation_passed set by the persist route is left intact. */
    preserveValidationPassed?: boolean;
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const updatePayload: Record<string, unknown> = {
        validation_report: params.report,
        updated_at: new Date().toISOString(),
      };
      if (!params.preserveValidationPassed) {
        updatePayload.validation_passed = params.passed ?? false;
      }
      const { error } = await service
        .from('analyses')
        .update(updatePayload)
        .eq('id', params.analysisId);

      if (error) {
        console.error('[SupabaseAnalysisAdapter] updateValidationReport failed:', error.message);
        throw error;
      }
    } catch (error: unknown) {
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
        .select(params.select || 'id, user_id')
        .eq('id', params.analysisId)
        .eq('user_id', params.userId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseAnalysisAdapter] verifyOwnership failed:', error.message);
        throw error;
      }
      return data;
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'verifyOwnership' },
        extra: { analysisId: params.analysisId, userId: params.userId },
      });
      throw error;
    }
  }

  /**
   * Persist the Dimension-0 executive digest jsonb for one owned analysis.
   * Scoped by user_id defense-in-depth. Returns true when a row was updated.
   */
  static async saveExecutiveDigest(params: {
    analysisId: string;
    userId: string;
    digest: unknown;
  }): Promise<boolean> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .update({ executive_digest: params.digest })
        .eq('id', params.analysisId)
        .eq('user_id', params.userId)
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('[SupabaseAnalysisAdapter] saveExecutiveDigest failed:', error.message);
        throw error;
      }
      return Boolean(data);
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'saveExecutiveDigest' },
        extra: { analysisId: params.analysisId, userId: params.userId },
      });
      throw error;
    }
  }

  /** Real segment timing for the source video, if still within the 72h
   *  retention window (ADR 012). Null once the transcript is purged. */
  static async getTranscriptSegments(videoId: string): Promise<Array<{ start: number; text: string }> | null> {
    try {
      const service = getSupabaseServiceClient();
      // Transcripts are stored under the CLEAN video_id (see upsertTranscript
      // / persist route), but an archived analysis row's video_id carries an
      // '_archived_<ts>' suffix (stripArchivedVideoIdSuffix). getAnalysisGrounding
      // (line 566) and findAnalysisByShareToken (line 685) already strip it
      // before their transcripts lookup -- this site historically did NOT,
      // so a digest/highlights re-trigger on an archived row queried
      // transcripts with the suffixed id and silently found nothing (real
      // no-op path in the 2026-08-23 highlights RCA). Strip here too for
      // consistency and defense-in-depth.
      const cleanVideoId = stripArchivedVideoIdSuffix(videoId) ?? videoId;
      // Enforce the 72h retention boundary (ADR 012) at the read path itself,
      // not only via the purge cron's eventual row deletion -- a delayed
      // purge run must not let extraction read past the stated compliance
      // window. Returns null if expired or missing.
      const { data, error } = await service
        .from('transcripts')
        .select('segments')
        .eq('video_id', cleanVideoId)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (error || !data?.segments || !Array.isArray(data.segments)) return null;

      const seenStarts = new Set<number>();
      return (data.segments as unknown[])
        .filter((s: any) => typeof s?.start === 'number' && typeof s?.text === 'string' && Number.isFinite(s.start) && s.start >= 0 && s.text.trim().length > 0)
        .map((s: any) => ({ start: s.start as number, text: s.text.trim() as string }))
        .filter((s) => {
          if (seenStarts.has(s.start)) return false;
          seenStarts.add(s.start);
          return true;
        })
        .sort((left, right) => left.start - right.start);
    } catch (error: unknown) {
      console.warn('[SupabaseAnalysisAdapter] getTranscriptSegments failed:', error instanceof Error ? error.message : String(error));
      Sentry.captureException(error, { tags: { method: 'getTranscriptSegments' } });
      return null;
    }
  }

  /** Atomic whole-set replacement of an analysis's highlights.
   *  Delegates to the `replace_analysis_highlights` RPC so the delete-and-insert
   *  runs atomically inside Postgres -- prevents the partial-state race where
   *  the insert failed after the delete succeeded (real P0 finding, review
   *  of PR #233). The RPC's plpgsql body is one implicit transaction. */
  static async saveHighlights(params: {
    analysisId: string;
    highlights: Array<{ idx: number; start: number; end: number; label: string; takeawayIdx?: number | null; verbatimExcerpt?: string }>;
  }): Promise<boolean> {
    try {
      const service = getSupabaseServiceClient();
      // Map camelCase TypeScript fields to the snake_case keys the RPC's
      // jsonb_array_elements reads (elem->>'takeaway_idx', elem->>'verbatim_excerpt').
      // Without this mapping, the camelCase keys would silently produce NULL for both
      // columns — a real data-loss bug caught in E2E verification.
      const p_highlights = params.highlights.map((h) => ({
        idx: h.idx,
        start: h.start,
        end: h.end,
        label: h.label,
        takeaway_idx: h.takeawayIdx ?? null,
        verbatim_excerpt: h.verbatimExcerpt ?? null,
      }));
      const { error } = await service.rpc('replace_analysis_highlights', {
        p_analysis_id: params.analysisId,
        p_highlights,
      });
      if (error) throw error;
      return true;
    } catch (error: unknown) {
      Sentry.captureException(error, { tags: { method: 'saveHighlights' }, extra: { analysisId: params.analysisId } });
      return false;
    }
  }

  /**
   * Atomic targeted jsonb sub-field update on executive_digest.reconciliation
   * only (2026-08-21, §2.B.6). Does NOT clobber snapshot/overview/takeaways/
   * detailedSummary written concurrently by saveExecutiveDigest — the
   * reconciliation pass runs after extractHighlights, which can race a
   * concurrent re-gen. Uses the set_executive_digest_reconciliation RPC for
   * an atomic jsonb_set at the SQL level (no read-modify-write race).
   */
  static async saveReconciliation(params: {
    analysisId: string;
    reconciliation: unknown;
  }): Promise<boolean> {
    try {
      const service = getSupabaseServiceClient();
      const { error } = await service.rpc('set_executive_digest_reconciliation', {
        p_analysis_id: params.analysisId,
        p_reconciliation: params.reconciliation,
      });
      if (error) throw error;
      return true;
    } catch (error: unknown) {
      Sentry.captureException(error, { tags: { method: 'saveReconciliation' }, extra: { analysisId: params.analysisId } });
      return false;
    }
  }

  /**
   * Atomically bump `viewed_count` for one owned analysis row (surfaced as
   * "Views" in the history overview). Delegates to the `increment_analysis_view`
   * RPC so the increment is a single `col = col + 1` UPDATE — a read-modify-write
   * would race concurrent opens and lose counts.
   *
   * Best-effort: a failed view bump must never break rendering the analysis, so
   * this method logs/reports errors instead of propagating them. The edge route
   * awaits it (there is no reliable post-response `waitUntil` there), so it is a
   * best-effort *awaited* call — one tiny UPDATE that cannot throw. It never
   * changes the response body or status, only whether the counter advanced.
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
