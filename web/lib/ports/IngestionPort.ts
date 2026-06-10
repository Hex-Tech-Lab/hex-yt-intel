
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

/** The signed streaming token handed to the client for direct browser→worker flow. */
export interface StreamToken {
  sig: string;
  exp: number;
}