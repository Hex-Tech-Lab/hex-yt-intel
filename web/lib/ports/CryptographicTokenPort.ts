import type { StreamToken } from '@/lib/types/stream-token';

export interface CryptographicTokenPort {
  signAnalysisToken(params: {
    videoId: string;
    analysisId: string;
    models: string[];
  }): Promise<StreamToken>;

  signChatToken(params: {
    conversationId: string;
    userId: string;
    models: string[];
  }): Promise<StreamToken>;

  signCommentsTier3Token(params: {
    sampleRunId: string;
    userId: string;
  }): Promise<StreamToken>;
}
