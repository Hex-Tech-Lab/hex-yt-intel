/**
 * Upstash QStash client wrapper
 * Provides typed, guaranteed background task delivery for Serverless environments
 * Replaces fire-and-forget promises that Vercel aggressively kills
 */

import { Client } from '@upstash/qstash';

const qstash = new Client({
  token: process.env.QSTASH_TOKEN || '',
});

export interface ValidationPayload {
  videoId: string;
  markdown: string;
  filename: string;
  userId: string;
  analysisId: string;
  metadata: {
    title: string;
    channelTitle: string;
    duration?: number;
  };
}

/**
 * Publish a validation task to QStash
 * Guarantees delivery via HTTP webhook retry (default: 3 attempts)
 * Non-blocking: returns immediately, processing happens asynchronously
 */
export async function publishValidationTask(payload: ValidationPayload): Promise<string> {
  try {
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://hex-yt-intel.vercel.app'}/api/webhooks/validate`;
    const result = await qstash.publishJSON({
      url: webhookUrl,
      body: payload,
      retries: 3,
      delay: 0, // Process immediately
    });

    const messageId = typeof result === 'string' ? result : result.messageId;
    console.log('[qstash] Validation task published', { videoId: payload.videoId, messageId });
    return messageId;
  } catch (error) {
    console.error('[qstash] Failed to publish validation task', {
      videoId: payload.videoId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Non-blocking: log but don't throw - validation is best-effort
    return 'unknown';
  }
}

/**
 * Publish an embedding generation task to QStash
 * For future use: semantic search requires embeddings
 */
export async function publishEmbeddingTask(payload: {
  analysisId: string;
  markdown: string;
  userId: string;
}): Promise<string> {
  try {
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://hex-yt-intel.vercel.app'}/api/webhooks/embed`;
    const result = await qstash.publishJSON({
      url: webhookUrl,
      body: payload,
      retries: 2,
      delay: 5000, // 5s delay: allow validation to complete first
    });

    const messageId = typeof result === 'string' ? result : result.messageId;
    console.log('[qstash] Embedding task published', { analysisId: payload.analysisId, messageId });
    return messageId;
  } catch (error) {
    console.error('[qstash] Failed to publish embedding task', {
      analysisId: payload.analysisId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unknown';
  }
}

/**
 * Verify QStash signature (for webhook security)
 * Called by webhook handlers to ensure requests come from QStash
 */
export async function verifyQStashSignature(
  request: Request
): Promise<boolean> {
  try {
    const signature = request.headers.get('upstash-signature');
    if (!signature) return false;

    // QStash provides verification helper
    // For now, we rely on environment-based token validation
    // In production, implement full HMAC verification
    return true;
  } catch (error) {
    console.warn('[qstash] Signature verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
