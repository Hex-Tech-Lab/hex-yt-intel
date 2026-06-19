import type { IngestionResult, VideoMetadata } from './IngestionPort';
import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import type { PersonaId } from '@/lib/prompts';

export interface MetadataIngestionPort {
  fetch(videoId: string): Promise<IngestionResult>;

  fetchOnlyMetadata(videoId: string): Promise<VideoMetadata>;

  detectPersona(params: {
    title: string;
    channelTitle: string;
    explicitPersona?: PersonaId;
  }): PersonaId;

  buildJobMetadata(metadata: VideoMetadata): AnalysisJobMetadata;
}
