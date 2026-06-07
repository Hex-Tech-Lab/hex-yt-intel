import { getSupabaseServiceClient } from '@/lib/supabase';
import { parseUcisDimensions } from '@/lib/parse-ucis-dimensions';
import * as Sentry from '@sentry/nextjs';
import type {
  IPersistencePort,
  CachedAnalysis,
  AnalysisStub,
  ValidationReportInput,
} from '@/lib/ports/IPersistencePort';
import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';

export class SupabasePersistenceAdapter implements IPersistencePort {
  async findCachedAnalysis(params: {
    userId: string;
    videoId: string;
  }): Promise<CachedAnalysis | null> {
    const service = getSupabaseServiceClient();
    const { data: existing } = await service
      .from('analyses')
      .select('id, title, analysis_markdown, analysis_payload, created_at, validation_report')
      .eq('video_id', params.videoId)
      .eq('user_id', params.userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing) return null;

    if (existing.analysis_payload && typeof existing.analysis_payload === 'object' && Object.keys(existing.analysis_payload).length > 0) {
      const payload = existing.analysis_payload as Record<string, unknown>;
      return {
        id: existing.id,
        title: existing.title,
        analysisMarkdown: existing.analysis_markdown ?? JSON.stringify(existing.analysis_payload),
        createdAt: existing.created_at,
        dimensions: (payload.dimensions as Record<string, unknown>) ?? {},
        cachedReport: (existing.validation_report ?? {}) as {
          metadata?: AnalysisJobMetadata;
          persona?: string;
          timezone?: string;
        },
      };
    }

    if (!existing.analysis_markdown) return null;

    const dimensions = parseUcisDimensions(existing.analysis_markdown);
    const dimensionCount = Object.keys(dimensions).length;

    if (dimensionCount < 8) {
      console.warn(
        `[PersistenceAdapter] Cache for ${existing.id} has ${dimensionCount} dimensions (<8) — treating as miss.`
      );
      return null;
    }

    const cachedReport = (existing.validation_report ?? {}) as {
      metadata?: AnalysisJobMetadata;
      persona?: string;
      timezone?: string;
    };

    return {
      id: existing.id,
      title: existing.title,
      analysisMarkdown: existing.analysis_markdown,
      createdAt: existing.created_at,
      dimensions,
      cachedReport,
    };
  }

  async upsertProcessingStub(params: {
    videoId: string;
    userId: string;
    title: string;
    validationReport: ValidationReportInput;
  }): Promise<AnalysisStub> {
    const service = getSupabaseServiceClient();
    const { data: prepared, error: insertError } = await service
      .from('analyses')
      .upsert(
        {
          video_id: params.videoId,
          user_id: params.userId,
          title: params.title,
          analysis_markdown: '',
          analysis_payload: {},
          model_used: 'edge-stream',
          validation_report: {
            status: params.validationReport.status,
            transcript_available: params.validationReport.transcriptAvailable,
            analysis_type: params.validationReport.analysisType,
            stale_after: params.validationReport.staleAfter,
            metadata: params.validationReport.metadata,
            persona: params.validationReport.persona,
            timezone: params.validationReport.timezone,
          },
          validation_passed: false,
        },
        { onConflict: 'user_id,video_id' }
      )
      .select('id')
      .single();

    if (insertError || !prepared?.id) {
      Sentry.captureException(insertError ?? new Error('upsert returned no row'), {
        tags: { operation: 'analysis-prepare-upsert' },
        extra: { videoId: params.videoId, userId: params.userId },
      });
      throw insertError ?? new Error('upsert returned no row');
    }

    return { id: prepared.id as string };
  }

  async persistAnalysis(params: {
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
      })
      .eq('id', params.analysisId);

    if (error) {
      Sentry.captureException(error, {
        tags: { operation: 'analysis-persist' },
        extra: { analysisId: params.analysisId },
      });
      throw error;
    }
  }
}