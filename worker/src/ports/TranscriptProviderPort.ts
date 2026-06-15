/**
 * TranscriptProviderPort — Domain Port (Hexagonal-Lite)
 *
 * Contract for transcript ingestion. TranscriptExtractor already satisfies this
 * shape; the port lets the orchestrator depend on the contract, not the adapter.
 */

export interface TranscriptResult {
  videoId: string;
  transcript: string;
  language: string;
}

export interface TranscriptProviderPort {
  fetch(videoId: string): Promise<TranscriptResult>;
}
