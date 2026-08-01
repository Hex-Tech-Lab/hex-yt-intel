import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import type { PersonaId } from '@/lib/prompts';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';
import type { ClientPlatform } from '@/lib/utils/client-platform';

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

/**
 * One video-centric history row: every analysis a user ran for the same
 * underlying video (collapsing archived re-runs) rolled up into a single entry.
 * Backs the history overview table.
 */
export interface HistoryOverviewItem {
  /** Canonical video id with any `_archived_<ts>` suffix stripped. */
  baseVideoId: string;
  /** Winner analysis id (most complete, newest on ties) — target for open/restore. */
  analysisId: string;
  title: string;
  channelTitle: string | null;
  /** ISO 8601 of the earliest / latest analysis for this video. */
  firstAnalyzedAt: string;
  lastAnalyzedAt: string;
  /** How many times this video was analyzed (including archived re-runs). */
  timesAnalyzed: number;
  /** Summed opens across every attempt. */
  views: number;
  /** Highest UCIS dimension count achieved across attempts (0..11). */
  bestDimensions: number;
  /** UCIS dimension numbers present in the winner analysis, ascending. */
  presentDimensions: number[];
  /** UCIS dimension numbers absent from the winner — offer to re-analyze these. */
  missingDimensions: number[];
  /** Honest rollup: complete (validated) | partial (usable) | processing | failed. */
  status: 'complete' | 'partial' | 'processing' | 'failed';
  /** Aux-element status row (Wave A4, mirrored from the console screen) for the winner analysis. */
  hasDigest: boolean;
  hasDescription: boolean;
  hasChannelMeta: boolean;
  hasComments: boolean;
  /** UA-derived device the winner analysis was run from. Null for rows predating this column. */
  clientPlatform: ClientPlatform | null;
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

export interface AnalysisPersistencePort {
  findCachedAnalysis(params: {
    userId: string;
    videoId: string;
  }): Promise<CachedAnalysis | null>;

  upsertProcessingStub(params: {
    videoId: string;
    userId: string;
    title: string;
    transcriptHash?: string;
    clientPlatform?: ClientPlatform | null;
    validationReport: ValidationReportInput;
  }): Promise<AnalysisStub>;

  /**
   * Persist a completed analysis. This port is a pure contract: implementations
   * perform a single idempotent write and surface failures by throwing. Retry
   * and error-state propagation are deliberately NOT the port's concern — they
   * are owned by the calling route/use-case layer (the persist route's
   * `retryWithBackoff` and the Worker's atomic-persist), so persistence
   * resilience policy lives once at that seam rather than in every adapter.
   */
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
   * Fetch the video-centric history overview: one aggregated row per underlying
   * video (archived re-runs collapsed), ordered by most-recently analyzed.
   */
  getUserHistoryOverview(params: { userId: string }): Promise<HistoryOverviewItem[]>;

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
   * Find analysis row for server-to-server persistence lookup.
   */
  findAnalysisForPersist(params: {
    analysisId: string;
    videoId: string;
  }): Promise<{
    id: string;
    userId: string;
    title: string;
    transcriptHash?: string | null;
    validationReport: unknown;
    createdAt: string;
    channelTitle?: string | null;
  } | null>;

  /**
   * Update the analysis row with the final reasoning results.
   *
   * `guardBillingStatus`, when provided, makes this a conditional update
   * (`WHERE billing_status = guardBillingStatus`) so a caller recovering a
   * stuck row (e.g. the analysis reaper) never clobbers a genuinely
   * concurrent, legitimate settle -- the returned `updated` flag tells the
   * caller whether it actually won the race.
   */
  updateAnalysisResult(params: {
    analysisId: string;
    markdown: string;
    payload: UCISPayloadV2 | null;
    model: string | null;
    validationPassed: boolean;
    validationReport: unknown;
    guardBillingStatus?: string;
  }): Promise<{ updated: boolean }>;

  persistAnalysisChunk(params: {
    analysisId: string;
    chunkIndex: number;
    dimensionsCovered: number[];
    payload: any;
    status: 'completed' | 'failed' | 'interrupted';
    // ADR 020 Phase 3: real OpenRouter usage/cost for this chunk's LLM call.
    tokensUsed?: number;
    costUsd?: number;
  }): Promise<void>;

  findAnalysisChunks(params: {
    analysisId: string;
  }): Promise<Array<{ chunk_index: number; dimensions_covered: number[]; payload: Record<string, unknown>; status: 'completed' | 'failed' | 'interrupted'; updated_at: string | null; tokens_used?: number; cost_usd?: number }> | null>;

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
    passed?: boolean;
    /** When true, only the report is written — validation_passed is left intact. */
    preserveValidationPassed?: boolean;
  }): Promise<void>;

  /**
   * Verify if the user owns the analysis and select optional fields.
   */
   verifyOwnership(params: {
    analysisId: string;
    userId: string;
    select: string;  // made required
  }): Promise<any | null>;

  /**
   * Persist the Dimension-0 executive digest (three-tier summary) for one owned
   * analysis. Scoped by user_id defense-in-depth even though the caller has
   * already verified ownership. Returns true when a row was updated.
   */
  saveExecutiveDigest(params: {
    analysisId: string;
    userId: string;
    digest: unknown;
  }): Promise<boolean>;
}

