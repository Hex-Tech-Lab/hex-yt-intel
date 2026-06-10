import type { IngestionResult, VideoMetadata } from './IngestionPort';
import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import type { PersonaId } from '@/lib/prompts';

/**
 * Handles only the retrieval of video metadata and transcripts, and persona detection.
 */
export interface MetadataIngestionPort {
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
   * Build the canonical AnalysisJobMetadata from raw video metadata.
   */
  buildJobMetadata(metadata: VideoMetadata): AnalysisJobMetadata;
}
