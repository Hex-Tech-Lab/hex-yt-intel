import { DecodoPort } from '@/lib/ports/DecodoPort';
import { fetchSubtitles, DecodoTranscriptResult } from '@/lib/services/decodo';

export class DecodoAdapter implements DecodoPort {
  async fetchTranscript(videoId: string): Promise<DecodoTranscriptResult> {
    return await fetchSubtitles(videoId);
  }
}
