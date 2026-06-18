import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import type { PersonaId } from '@/lib/prompts';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';

/** A cached analysis row retrieved for potential cache-hit return. */
export interface CachedAnalysis {
  id: string;
  videoId: string;
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
  analysisPayload?: UCISPayloadV2 | null;
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

export interface PersistencePort {
  findCachedAnalysis(params: {
    userId: string;
    videoId: string;
  }): Promise<CachedAnalysis | null>;

  upsertProcessingStub(params: {
    videoId: string;
    userId: string;
    title: string;
    validationReport: ValidationReportInput;
  }): Promise<AnalysisStub>;

  persistAnalysis(params: {
    analysisId: string;
    analysisPayload: UCISPayloadV2 | null;
    analysisMarkdown: string;
    validationPassed: boolean;
  }): Promise<void>;

  /**
   * Fetch analysis history for the user. Limits to 50 items.
   */
  getUserHistory(params: { userId: string }): Promise<Array<{
    id: string;
    videoId: string;
    title: string;
    createdAt: string;
    status: 'completed' | 'processing' | 'incomplete';
  }>>;

  /**
   * Look up a single analysis by its ID and userId.
   */
  findAnalysisById(params: {
    userId: string;
    analysisId: string;
  }): Promise<{
    id: string;
    title: string;
    videoId: string;
    analysisMarkdown: string;
    createdAt: string;
  } | null>;

  /**
   * Update the user subscription tier.
   */
  updateUserTier(params: {
    userId: string;
    tier: 'pro' | 'free';
  }): Promise<void>;

  /**
   * Find analysis row for server-to-server persistence lookup.
   */
  findAnalysisForPersist(params: {
    analysisId: string;
    videoId: string;
  }): Promise<{
    id: string;
    userId: string;
    title: string;
    validationReport: unknown;
    createdAt: string;
    channelTitle?: string | null;
  } | null>;

  /**
   * Update the analysis row with the final reasoning results.
   */
  updateAnalysisResult(params: {
    analysisId: string;
    markdown: string;
    payload: UCISPayloadV2 | null;
    model: string | null;
    validationPassed: boolean;
    validationReport: unknown;
  }): Promise<void>;

  persistKnowledgeGraph(params: {
    analysisId: string;
    entities: Array<{
      label: string;
      type: string;
      weight: number;
      rawNode?: any;
    }>;
    relations: Array<{
      source: string;
      target: string;
      relation: string;
      strength: number;
      rawEdge?: any;
    }>;
  }): Promise<void>;

  getKnowledgeGraph(analysisId: string): Promise<{
    entities: Array<{ id: string; label: string; type: string; weight: number; raw_node?: any }>;
    relations: Array<{ source_entity_id: string; target_entity_id: string; relation_label: string; strength: number; raw_edge?: any }>;
  } | null>;

  /**
   * Update the billing/quota status of an analysis.
   */
  updateBillingStatus(params: {
    analysisId: string;
    status: 'processing' | 'completed' | 'failed';
  }): Promise<void>;

  persistAnalysisChunk(params: {
    analysisId: string;
    chunkIndex: number;
    dimensionsCovered: number[];
    payload: any;
    status: 'completed' | 'failed' | 'interrupted';
  }): Promise<void>;

  findAnalysisChunks(params: {
    analysisId: string;
  }): Promise<Array<{ chunk_index: number; dimensions_covered: number[]; payload: Record<string, unknown>; status: 'completed' | 'failed' | 'interrupted'; updated_at: string | null }> | null>;

  /**
   * Find analysis by share token for public view.
   */
  findAnalysisByShareToken(token: string): Promise<{
    id: string;
    title: string;
    channelTitle: string | null;
    analysisMarkdown: string | null;
    sharedExpiresAt: string | null;
    createdAt: string;
  } | null>;

  /**
   * Update validation report and status.
   */
  updateValidationReport(params: {
    analysisId: string;
    report: any;
    passed: boolean;
  }): Promise<void>;
}