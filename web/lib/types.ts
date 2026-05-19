/**
 * Global Type Definitions
 * Shared types used across the application
 */

export interface AnalysisResult {
  id: string;
  title: string;
  analysis_markdown: string;
}

export interface AnalysisMetadata {
  title: string;
  channelTitle: string;
  duration?: number;
}

export interface VideoMetadata {
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

export interface UseAnalysisStreamState {
  analysis: AnalysisResult | null;
  isLoading: boolean;
  status: AnalysisStatus;
  error: string | null;
  lockoutTimeRemaining: number;
}
