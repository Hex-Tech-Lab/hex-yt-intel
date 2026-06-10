import type { StreamToken } from '@/lib/types/stream-token';

export type { StreamToken };

/** Video metadata fetched from the YouTube/Worker pipeline. */
export interface VideoMetadata {
  title: string;
  channelTitle: string;
  publishedAt: string;
  duration: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

/** Result of the parallel ingestion phase. */
export interface IngestionResult {
  /** YouTube video metadata (title, channel, counts). */
  metadata: VideoMetadata;
  /** Extracted transcript text. Empty string if unavailable. */
  transcript: string;
  /** Whether the transcript was successfully extracted. */
  transcriptAvailable: boolean;
}