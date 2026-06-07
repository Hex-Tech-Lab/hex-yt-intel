import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import type { PersonaId } from '@/lib/prompts';
import type { UserTier } from '@/lib/types/billing';

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

/**
 * Handles the ingestion phase: parallel metadata + transcript fetch, persona
 * detection, model cascade resolution, and HMAC stream token signing.
 *
 * Current implementation: fetchWorkerMetadata() + fetchSubtitles() +
 * detectPersona() + resolveModelCascade() + signStreamToken()
 */
export interface IIngestionPort {
  /**
   * Fetch video metadata and transcript in parallel.
   * @throws When metadata fetch fails (caller must refund quota).
   * @returns IngestionResult with transcript possibly empty.
   */
  fetch(videoId: string): Promise<IngestionResult>;

  /**
   * Detect the target persona from video title + channel, or use the explicit override.
   */
  detectPersona(params: {
    title: string;
    channelTitle: string;
    explicitPersona?: PersonaId;
  }): PersonaId;

  /**
   * Resolve the ordered model cascade for the given tier and kind.
   * Precedence: testOverride → plans[tier][kind] → hardcoded fallback.
   */
  resolveModels(tier: UserTier, kind: 'analysis' | 'chat'): Promise<string[]>;

  /**
   * Mint an HMAC-signed streaming token bound to videoId + analysisId + models.
   * The worker verifies byte-identical signature before streaming.
   */
  signToken(params: {
    videoId: string;
    analysisId: string;
    models: string[];
  }): StreamToken;

  /**
   * Build the canonical AnalysisJobMetadata from raw video metadata.
   * Stringifies numeric counts to match the WorkerStreamRequest contract.
   */
  buildJobMetadata(metadata: VideoMetadata): AnalysisJobMetadata;
}