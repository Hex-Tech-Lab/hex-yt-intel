import { signStreamToken, signChatToken, signCommentsTier3Token } from '@/lib/stream-token';
import type { StreamToken, CryptographicTokenPort } from '@/lib/ports';

/**
 * Sign HMAC tokens for authenticated streaming between Vercel and Cloudflare Worker.
 * Wraps low-level signing functions with port interface.
 */
export class StreamTokenAdapter implements CryptographicTokenPort {
  /**
   * Sign an analysis stream token bound to videoId, analysisId, and models.
   * @param params Video and analysis IDs, plus model list
   * @returns Stream token with signature and expiry
   */
  async signAnalysisToken(params: {
    videoId: string;
    analysisId: string;
    models: string[];
  }): Promise<StreamToken> {
    return signStreamToken(params.videoId, params.analysisId, params.models);
  }

  /**
   * Sign a chat stream token bound to conversationId, userId, and models.
   * @param params Conversation and user IDs, plus model list
   * @returns Stream token with signature and expiry
   */
  async signChatToken(params: {
    conversationId: string;
    userId: string;
    models: string[];
  }): Promise<StreamToken> {
    return signChatToken(params.conversationId, params.userId, params.models);
  }

  /**
   * Sign a Tier 3 comments-fetch enqueue token bound to sampleRunId + userId.
   * @param params Sample-run and user IDs
   * @returns Stream token with signature and expiry
   */
  async signCommentsTier3Token(params: {
    sampleRunId: string;
    userId: string;
  }): Promise<StreamToken> {
    return signCommentsTier3Token(params.sampleRunId, params.userId);
  }
}
