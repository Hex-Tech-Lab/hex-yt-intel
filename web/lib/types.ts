/**
 * Global Type Definitions
 * Shared types used across the application
 */

export interface AnalysisResult {
  id: string;
  title: string;
  analysis_markdown: string;
  /** Dimension 0 executive digest (zero-dimensional analyses may have only this) */
  executiveDigest?: Record<string, unknown> | null;
}

export interface AnalysisMetadata {
  title: string;
  channelTitle: string;
  duration?: number;
}

export interface VideoMetadata {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  duration: number | null;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  thumbnailUrl: string | null;
  description?: string;
}

export type AnalysisStatus = 'idle' | 'downloading' | 'parsing' | 'analyzing' | 'complete' | 'error';

/**
 * Structured analysis error.
 *
 * Replaces the prior stringly-typed `"{status}:{message}"` encoding. Consumers
 * branch on `code` (an ERR_* registry value) and `status` (HTTP status) instead
 * of substring parsing, decoupling the producer (useSSEStream) from the
 * renderer (AnalysisError).
 */
export interface AnalysisErrorState {
  code: string;
  status: number;
  message: string;
  /**
   * Set only for the "dead analysis with some dimensions already salvaged"
   * case (ADR 021 Phase 2's /api/analyses/check presence-check, consumed by
   * useAutoRestoreAnalysis.ts) -- the dimension numbers NOT yet recovered.
   * Lets the UI distinguish "some real content exists and is being finished
   * automatically by remediation" from a genuine total failure, instead of
   * rendering the same bare "Synthesis failed" for both (live-reported
   * confusion, video NE-62S4OYCg/analysis 32aeeb78, 2026-09-09/10: a user
   * checking for a specific dimension found it silently missing with no
   * indication anything was still in progress).
   */
  missingDimensions?: number[];
}

export interface UseAnalysisStreamState {
  analysis: AnalysisResult | null;
  isLoading: boolean;
  status: AnalysisStatus;
  error: AnalysisErrorState | null;
  lockoutTimeRemaining: number;
}
