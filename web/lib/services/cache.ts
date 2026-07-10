/**
 * Analysis Result Caching Layer
 *
 * Implements Cache-Aside pattern using Upstash KV:
 * 1. Check KV for cached result (key: ci:{modelUsed}:{transcriptHash}:{schemaVersion})
 * 2. If MISS: Proceed to model inference
 * 3. If HIT: Return cached full JSON object (validation_report + analysis_markdown)
 * 4. After inference: Store full result in KV for next request
 *
 * TTL: 7 days (604800 seconds) for free-tier quota preservation
 */

import { Redis } from '@upstash/redis';

// Lazy-loaded Redis client (prevents build-time instantiation crash)
let redisInstance: Redis | null = null;

function getRedisClient(): Redis | null {
  if (redisInstance) return redisInstance;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn('[cache] Upstash credentials not configured');
    return null;
  }

  try {
    redisInstance = new Redis({ url, token });
    return redisInstance;
  } catch (error) {
    console.error('[cache] Failed to initialize Redis:', error);
    return null;
  }
}

export interface CachedAnalysisResult {
  id: string;
  video_id: string;
  title: string;
  analysis_markdown: string;
  analysis_payload?: Record<string, unknown> | null;  // ADR 006: v2.0 structured JSON
  validation_report: {
    transcript_available: boolean;
    analysis_type: 'full' | 'metadata-only';
    warning?: string;
  };
  model_used: string;
  created_at: string;
  cached_at: string;
}

/**
 * Generate cache key from analysis parameters
 * Format: ci:{modelUsed}:{transcriptHash}:{schemaVersion}
 *
 * CONTRACT: Caller MUST pass a SHA256 hash of the original transcript (first 16+ chars),
 * NOT the raw transcript or markdown output.
 * This ensures cache keys are stable and based on INPUT per ADR 006.
 *
 * STRICT: throws if hash is empty or falsy. No fallback to empty string.
 * Callers must compute transcript hash explicitly or use '' fallback upstream.
 *
 * @param modelUsed - Model identifier (e.g., 'edge-stream', 'claude-3.5-sonnet')
 * @param transcriptHash - Pre-computed SHA256 transcript hash (first 16+ chars), must be non-empty
 * @param schemaVersion - Schema version (default: '5.1')
 * @returns Cache key in format ci:{modelUsed}:{transcriptHash}:{schemaVersion}
 * @throws Error if transcriptHash is falsy (empty string, null, undefined)
 */
export function generateCacheKey(
  modelUsed: string,
  transcriptHash: string,
  schemaVersion: string = '5.1'
): string {
  if (!transcriptHash || typeof transcriptHash !== 'string' || transcriptHash.trim() === '') {
    throw new Error(
      "[cache] generateCacheKey: transcriptHash is required and must be non-empty. " +
      `Got: ${typeof transcriptHash} "${transcriptHash}". ` +
      "Per ADR 006, cache keys must be based on INPUT (transcript hash), not output."
    );
  }

  const cacheHash = transcriptHash.substring(0, 16);
  return `ci:${modelUsed}:${cacheHash}:${schemaVersion}`;
}

/**
 * Retrieve cached analysis result from Upstash KV
 * Returns null if cache miss or error
 */
export async function getAnalysisCache(cacheKey: string): Promise<CachedAnalysisResult | null> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      console.warn('[cache] Redis not available, skipping cache read');
      return null;
    }

    const cached = await redis.get<CachedAnalysisResult>(cacheKey);

    if (cached) {
      console.log('[cache] HIT', { cacheKey, analysisId: cached.id });
      return cached;
    }

    console.log('[cache] MISS', { cacheKey });
    return null;
  } catch (error) {
    console.error('[cache] Failed to read from Upstash', { cacheKey, error });
    // Graceful degradation: cache miss on error, proceed to inference
    return null;
  }
}

/**
 * Store analysis result in Upstash KV
 * TTL: 7 days (604800 seconds)
 */
export async function setAnalysisCache(
  cacheKey: string,
  result: CachedAnalysisResult
): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      console.warn('[cache] Redis not available, skipping cache write');
      return;
    }

    // Add cached_at timestamp
    const resultWithTimestamp = {
      ...result,
      cached_at: new Date().toISOString(),
    };

    const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
    await redis.setex(cacheKey, TTL_SECONDS, resultWithTimestamp);

    console.log('[cache] WRITE', { cacheKey, ttl: TTL_SECONDS, analysisId: result.id });
  } catch (error) {
    console.error('[cache] Failed to write to Upstash', { cacheKey, error });
    // Non-blocking cache write failure; analysis continues normally
  }
}

/**
 * Clear cache entry (used when analysis is updated or invalidated)
 */
export async function clearAnalysisCache(cacheKey: string): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      return;
    }

    await redis.del(cacheKey);
    console.log('[cache] CLEARED', { cacheKey });
  } catch (error) {
    console.error('[cache] Failed to clear Upstash cache', { cacheKey, error });
  }
}
