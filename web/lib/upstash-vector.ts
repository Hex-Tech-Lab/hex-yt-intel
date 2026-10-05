import { Index } from '@upstash/vector';

/**
 * Configuration-validity rule for the Upstash Vector index — the SINGLE
 * source used by initializeVectorIndex and by health/status reporters, so a
 * credential shape that makes the index unusable can never be reported as
 * healthy (PR #438 C1). Rejects missing values and placeholder/mock strings
 * (web/lib/env.ts's mock fallbacks, e.g. 'mock-vector-token', fail this check).
 */
export function isVectorConfigured(): boolean {
  const url = process.env.UPSTASH_VECTOR_REST_URL || '';
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN || '';
  return [url, token].every((value) => value !== '' && !value.includes('placeholder') && !value.includes('mock'));
}

/**
 * Initialize Upstash Vector index with environment credentials.
 * Returns null if credentials are not configured (e.g., in preview or dev environments).
 */
export function initializeVectorIndex(): Index | null {
  if (!isVectorConfigured()) return null;
  return new Index({
    url: process.env.UPSTASH_VECTOR_REST_URL || '',
    token: process.env.UPSTASH_VECTOR_REST_TOKEN || '',
  });
}
