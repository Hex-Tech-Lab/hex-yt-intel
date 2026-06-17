import { signStreamToken, signChatToken } from '@/lib/stream-token';
import type { StreamToken, CryptographicTokenPort } from '@/lib/ports';

export class StreamTokenAdapter implements CryptographicTokenPort {
  async signAnalysisToken(params: {
    videoId: string;
    analysisId: string;
    models: string[];
  }): Promise<StreamToken> {
    return signStreamToken(params.videoId, params.analysisId, params.models);
  }

  async signChatToken(params: {
    conversationId: string;
    userId: string;
    models: string[];
  }): Promise<StreamToken> {
    return signChatToken(params.conversationId, params.userId, params.models);
  }
}
