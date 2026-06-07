import { signStreamToken } from '@/lib/stream-token';
import type { StreamToken } from '@/lib/ports/IIngestionPort';

export class StreamTokenAdapter {
  signAnalysisToken(params: {
    videoId: string;
    analysisId: string;
    models: string[];
  }): StreamToken {
    return signStreamToken(params.videoId, params.analysisId, params.models);
  }
}