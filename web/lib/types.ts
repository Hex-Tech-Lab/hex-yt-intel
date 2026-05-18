/**
 * Centralized type definitions for YouTube content intelligence system
 * Single source of truth for API contracts, data shapes, and domain models
 */

export interface VideoMetadata {
  title: string;
  channelTitle: string;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  publishedAt: string;
  duration?: number;
  videoId?: string;
}

export interface AnalysisResult {
  id: string;
  videoId?: string;
  title: string;
  markdown: string;
  createdAt?: string;
  model_attempted?: string;
  model_used?: string;
  cacheHit?: boolean;
  message?: string;
}

export interface AnalysisRequest {
  url: string;
  timezone: string;
  persona?: string;
}

export interface UseAnalysisStreamState {
  analysis: { id: string; title: string; markdown: string } | null;
  isLoading: boolean;
  status: 'idle' | 'downloading' | 'parsing' | 'analyzing' | 'complete' | 'error';
  error: string | null;
  lockoutTimeRemaining: number;
}

export interface UseAnalysisStreamActions {
  startAnalysis: (url: string, timezone: string) => Promise<void>;
  clearAnalysis: () => void;
}

export interface UseAnalysisStreamReturn extends UseAnalysisStreamState, UseAnalysisStreamActions {}

export interface PersonaConfiguration {
  personaId: string;
  name: string;
  weight: number;
}

export interface ValidationReport {
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: Array<{
    name: string;
    reason: string;
  }>;
}

export interface RateLimitInfo {
  allowed: boolean;
  remaining: number;
  resetTime?: number;
}

export interface UserQuotaInfo {
  tier: 'free' | 'pro' | 'enterprise';
  analysesUsed: number;
  limit: number | null;
  resetDate: string;
}

export type PersonaId = 'p1' | 'p2' | 'p3' | 'p4' | 'p5';

export type AnalysisDomain =
  | 'Technology'
  | 'Finance'
  | 'Health'
  | 'Education'
  | 'Business'
  | 'Design'
  | 'Other';
