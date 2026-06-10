import { signStreamToken, signChatToken } from '@/lib/stream-token';
import type { StreamToken, CryptographicTokenPort } from '@/lib/ports';

export class StreamTokenAdapter implements CryptographicTokenPort {
  signAnalysisToken(params: {
    videoId: string;
    analysisId: string;
    models: string[];
  }): StreamToken {
    return signStreamToken(params.videoId, params.analysisId, params.models);
  }

  signChatToken(params: {
    conversationId: string;
    userId: string;
    models: string[];
  }): StreamToken {
    return signChatToken(params.conversationId, params.userId, params.models);
  }
}