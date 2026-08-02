/**
 * TranscriptProviderPort — Domain Port (Hexagonal-Lite)
 *
 * Contract for transcript ingestion. TranscriptExtractor already satisfies this
 * shape; the port lets the orchestrator depend on the contract, not the adapter.
 */

export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

export interface TranscriptResult {
  videoId: string;
  transcript: string;
  language: string;
  segments?: TranscriptSegment[];
  // True only when a source (YouTube's own caption-list API, or the page's
  // own ytInitialData) affirmatively confirmed zero caption tracks exist --
  // distinct from every fallback tier simply failing to reach an answer
  // (network error, timeout, proxy/Decodo outage). Absent/false means "we
  // don't know," which callers should treat as a retryable pipeline issue,
  // not a permanent fact about the video.
  confirmedNoCaptions?: boolean;
}

export interface TranscriptProviderPort {
  fetch(videoId: string): Promise<TranscriptResult>;
}
