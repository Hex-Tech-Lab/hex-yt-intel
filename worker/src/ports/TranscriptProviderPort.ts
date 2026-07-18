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
}

export interface TranscriptProviderPort {
  fetch(videoId: string): Promise<TranscriptResult>;
}
