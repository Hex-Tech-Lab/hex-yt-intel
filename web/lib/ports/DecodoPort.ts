import { DecodoTranscriptResult } from '@/lib/services/decodo';

export interface DecodoPort {
  fetchTranscript(videoId: string): Promise<DecodoTranscriptResult>;
}
