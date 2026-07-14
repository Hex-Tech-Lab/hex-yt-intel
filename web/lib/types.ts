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
}

export interface UseAnalysisStreamState {
  analysis: AnalysisResult | null;
  isLoading: boolean;
  status: AnalysisStatus;
  error: AnalysisErrorState | null;
  lockoutTimeRemaining: number;
}
