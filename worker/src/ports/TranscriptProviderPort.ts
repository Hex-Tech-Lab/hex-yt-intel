/**
 * TranscriptProviderPort — Domain Port (Hexagonal-Lite)
 *
 * Contract for transcript ingestion. TranscriptExtractor already satisfies this
 * shape; the port lets the orchestrator depend on the contract, not the adapter.
 */

import type { TranscriptResult } from '../services/TranscriptExtractor';

export type { TranscriptResult };

export interface TranscriptProviderPort {
  fetch(videoId: string): Promise<TranscriptResult>;
}
