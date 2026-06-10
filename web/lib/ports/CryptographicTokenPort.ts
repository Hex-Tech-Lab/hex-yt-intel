import type { StreamToken } from '@/lib/types/stream-token';

export interface CryptographicTokenPort {
  signAnalysisToken(params: {
    videoId: string;
    analysisId: string;
    models: string[];
  }): StreamToken;

  signChatToken(params: {
    conversationId: string;
    userId: string;
    models: string[];
  }): StreamToken;
}
