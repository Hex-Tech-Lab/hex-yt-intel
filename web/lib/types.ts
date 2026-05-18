/**
 * Global Type Definitions
 * Shared types used across the application
 */

export interface AnalysisResult {
  id: string;
  title: string;
  markdown: string;
}

export interface AnalysisMetadata {
  title: string;
  channelTitle: string;
  duration?: number;
}

export type AnalysisStatus = 'idle' | 'downloading' | 'parsing' | 'analyzing' | 'complete' | 'error';
