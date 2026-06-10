import type { StreamToken } from './IngestionPort';

/**
 * Handles signing streaming access tokens bound to video, analysis job, and resolved models list.
 */
export interface CryptographicTokenPort {
  /**
   * Mint an HMAC-signed streaming token bound to videoId + analysisId + models.
   */
  signAnalysisToken(params: {
    videoId: string;
    analysisId: string;
    models: string[];
  }): StreamToken;

  /**
   * Mint an HMAC-signed chat token bound to conversationId + userId + models.
   */
  signChatToken(params: {
    conversationId: string;
    userId: string;
    models: string[];
  }): StreamToken;
}
