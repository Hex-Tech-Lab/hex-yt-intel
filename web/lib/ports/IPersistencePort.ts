import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import type { PersonaId } from '@/lib/prompts';

/** A cached analysis row retrieved for potential cache-hit return. */
export interface CachedAnalysis {
  id: string;
  title: string;
  analysisMarkdown: string;
  createdAt: string;
  /** Parsed UCIS dimensions from the markdown (keyed by dimension index). */
  dimensions: Record<string, unknown>;
  /** Metadata + persona + timezone persisted in validation_report at job creation. */
  cachedReport: {
    metadata?: AnalysisJobMetadata;
    persona?: string;
    timezone?: string;
  };
}

/** The freshly-created analysis stub row returned after upsert. */
export interface AnalysisStub {
  id: string;
}

/** Parameters for the validation_report blob persisted alongside the stub. */
export interface ValidationReportInput {
  status: 'processing';
  transcriptAvailable: boolean;
  analysisType: 'full';
  staleAfter: string; // ISO 8601
  metadata: AnalysisJobMetadata;
  persona: PersonaId;
  timezone: string;
}

/**
  * Handles all Supabase persistence for the analyses table:
  *   - Cache-hit lookup (SELECT with dimension validation)
  *   - Processing stub upsert (UPSERT on user_id + video_id conflict)
  *
  * Current implementation: getSupabaseServiceClient() + direct .from('analyses') calls.
  */
export interface IPersistencePort {
  /**
   * Look up the most recent analysis for (userId, videoId).
   * Returns null if no row exists or the markdown is empty/stub (< 8 dimensions).
   * The dimension count threshold (8) matches the worker's validate12D gate.
   */
  findCachedAnalysis(params: {
    userId: string;
    videoId: string;
  }): Promise<CachedAnalysis | null>;

  /**
   * Upsert a processing stub row. Uses ON CONFLICT (user_id, video_id) so
   * re-analysis of the same video reuses the existing row instead of 23505-ing.
   * @throws When the upsert fails (caller must refund quota).
   */
  upsertProcessingStub(params: {
    videoId: string;
    userId: string;
    title: string;
    validationReport: ValidationReportInput;
  }): Promise<AnalysisStub>;

  /**
   * Persist the final analysis result after worker completion.
   * Updates the analysis row with the markdown, payload, and validation status.
   */
  persistAnalysis(params: {
    analysisId: string;
    analysisPayload: Record<string, unknown>;
    analysisMarkdown: string;
    validationPassed: boolean;
  }): Promise<void>;
}