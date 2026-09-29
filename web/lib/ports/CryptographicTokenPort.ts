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

  /** R2b: sign server-loaded grounded context for a projective bundle. */
  signProjectiveContext(params: {
    analysisId: string;
    dimensions: readonly number[];
    priorPayload: unknown;
  }): Promise<StreamToken>;
}
