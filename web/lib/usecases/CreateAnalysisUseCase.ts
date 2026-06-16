import type {
  MetadataIngestionPort,
  DecodoPort,
} from '@/lib/ports';
import { extractVideoId } from '@/lib/youtube';

export interface CreateAnalysisUseCaseParams {
  url: string;
}

// (Omitted interfaces for brevity: CacheHitData, ProcessingData, UseCaseResult - they are unchanged)
export type UseCaseResult = any;

export class CreateAnalysisUseCase {
  constructor(
    private metadataIngestion: MetadataIngestionPort,
    private decodo: DecodoPort
  ) {}

  async execute(params: CreateAnalysisUseCaseParams): Promise<UseCaseResult> {
    const videoId = extractVideoId(params.url);
    if (!videoId) {
      return { type: 'error', code: 'ERR_INVALID_URL', status: 400, message: 'Invalid YouTube URL' };
    }

    // 1. Cache hit lookup (Omitted)
    
    // 2.5 Insert processing stub (Omitted)

    // 3. Metadata + Transcript Ingestion
    let ingestionResult;
    try {
      ingestionResult = await this.metadataIngestion.fetch(videoId);
      
      if (!ingestionResult.transcriptAvailable) {
        console.log(`[CreateAnalysisUseCase] Native transcript empty for ${videoId}, attempting Decodo fallback...`);
        const decodoResult = await this.decodo.fetchTranscript(videoId);
        if (decodoResult.success && decodoResult.transcript) {
          ingestionResult.transcript = decodoResult.transcript.trim();
          ingestionResult.transcriptAvailable = true;
          console.log(`[CreateAnalysisUseCase] Decodo fallback successful for ${videoId}`);
        }
      } else {
        ingestionResult.transcript = ingestionResult.transcript.trim();
      }
    } catch (error) {
      // ...
    }
    return { type: 'processing', data: {} as any };
  }
}
