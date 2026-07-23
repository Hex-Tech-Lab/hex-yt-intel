import type { StreamToken } from '@/lib/types/stream-token';

export type { StreamToken };

/** Video metadata fetched from the YouTube/Worker pipeline. */
export interface VideoMetadata {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  duration: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  description?: string;
  channelId?: string;
  thumbnailUrl?: string | null;
}

/** Timed transcript segment, as returned by the worker's TranscriptExtractor. */
export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

/** Result of the parallel ingestion phase. */
export interface IngestionResult {
  /** YouTube video metadata (title, channel, counts). */
  metadata: VideoMetadata;
  /** Extracted transcript text. Empty string if unavailable. */
  transcript: string;
  /** Whether the transcript was successfully extracted. */
  transcriptAvailable: boolean;
  /**
   * Timed segments, when the worker's /fetch-transcript response included them
   * (TranscriptExtractor.fetch() always produces them internally). Previously
   * discarded at this boundary -- the browser then sent only flat transcript
   * text onward to the streaming endpoint, so analyze-llm-stream's own
   * fetchTranscriptIfMissing() short-circuited (transcript already present)
   * and NEVER fetched segments either, meaning timestamped-transcript chat
   * grounding was unreachable for the common (transcript-succeeds) case.
   */
  segments?: TranscriptSegment[];
}