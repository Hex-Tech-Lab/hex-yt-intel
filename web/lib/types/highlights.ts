import type { StoredExecutiveDigest } from '@/lib/ports/ExecutiveDigestPorts';

export interface HighlightData {
  idx: number;
  start: number;
  end: number;
  label: string;
  takeawayIdx: number | null;
  verbatimExcerpt: string | null;
}

export interface AnalysisGroundingData {
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
  highlights?: HighlightData[] | null;
}
