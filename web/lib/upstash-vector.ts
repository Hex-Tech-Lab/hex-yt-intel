import { Index } from '@upstash/vector';

/**
 * Initialize Upstash Vector index with environment credentials.
 * Returns null if credentials are not configured (e.g., in preview or dev environments).
 */
export function initializeVectorIndex(): Index | null {
  const url = process.env.UPSTASH_VECTOR_REST_URL || '';
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN || '';

  if (
    !url || url.includes('placeholder') || url.includes('mock') ||
    !token || token.includes('placeholder') || token.includes('mock')
  ) {
    return null;
  }

  return new Index({ url, token });
}
