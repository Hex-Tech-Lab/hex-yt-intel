/**
 * Upstash Redis Client Configuration
 *
 * Provides a singleton Redis client for distributed rate limiting,
 * session caching, and other transient data storage.
 *
 * REST API pattern used: No direct TCP connection (compatible with serverless)
 * Automatic fallback to in-memory cache if Redis is unavailable
 */

import { Redis } from '@upstash/redis';

/**
 * In-memory fallback cache for when Redis is unavailable
 * Structure: { key: { value, expireAt } }
 * Used in development and when UPSTASH credentials are missing
 */
const memoryCache = new Map<string, { value: any; expireAt: number }>();

/**
 * Singleton Redis instance
 * Lazily initialized on first use
 */
let redisInstance: Redis | null = null;
let redisAvailable: boolean | null = null;

/**
 * Initialize Redis client if credentials are available
 * Falls back to in-memory cache if credentials are missing or connection fails
 */
function initializeRedis(): Redis | null {
  if (redisInstance) {
    return redisInstance;
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    console.warn('[redis.ts] Redis credentials not configured, using in-memory cache');
    return null;
  }

  try {
    redisInstance = new Redis({
      url: redisUrl,
      token: redisToken,
    });
    redisAvailable = true;
    console.log('[redis.ts] Redis client initialized');
    return redisInstance;
  } catch (error) {
    console.error('[redis.ts] Failed to initialize Redis client:', error);
    redisAvailable = false;
    return null;
  }
}

/**
 * Get a value from Redis (or memory cache if Redis unavailable)
 */
export async function getRedisValue(key: string): Promise<any> {
  const redis = initializeRedis();

  try {
    if (redis && redisAvailable) {
      return await redis.get(key);
    }
  } catch (error) {
    console.warn(`[redis.ts] Failed to get key ${key}:`, error);
  }

  // Fallback to memory cache
  const cached = memoryCache.get(key);
  if (cached && cached.expireAt > Date.now()) {
    return cached.value;
  }

  if (cached) {
    memoryCache.delete(key);
  }

  return null;
}

/**
 * Set a value in Redis with optional expiration
 */
export async function setRedisValue(
  key: string,
  value: any,
  expirationSeconds?: number
): Promise<void> {
  const redis = initializeRedis();

  try {
    if (redis && redisAvailable) {
      if (expirationSeconds) {
        await redis.setex(key, expirationSeconds, value);
      } else {
        await redis.set(key, value);
      }
      return;
    }
  } catch (error) {
    console.warn(`[redis.ts] Failed to set key ${key}:`, error);
  }

  // Fallback to memory cache
  const expireAt = expirationSeconds
    ? Date.now() + expirationSeconds * 1000
    : Date.now() + 86400000; // 24 hours default
  memoryCache.set(key, { value, expireAt });
}

/**
 * Increment a numeric value in Redis
 * Used for rate limiting counters
 */
export async function incrementRedisValue(key: string, amount: number = 1): Promise<number> {
  const redis = initializeRedis();

  try {
    if (redis && redisAvailable) {
      if (amount === 1) {
        return await redis.incr(key);
      } else {
        return await redis.incrby(key, amount);
      }
    }
  } catch (error) {
    console.warn(`[redis.ts] Failed to increment key ${key}:`, error);
  }

  // Fallback to memory cache
  const cached = memoryCache.get(key);
  const current = (cached?.value || 0) + amount;
  memoryCache.set(key, {
    value: current,
    expireAt: cached?.expireAt || Date.now() + 86400000,
  });
  return current;
}

/**
 * Set expiration on an existing key
 * Used to set TTL on rate limit counters
 */
export async function setRedisExpiration(key: string, expirationSeconds: number): Promise<boolean> {
  const redis = initializeRedis();

  try {
    if (redis && redisAvailable) {
      const result = await redis.expire(key, expirationSeconds);
      return result === 1; // 1 = success, 0 = key doesn't exist
    }
  } catch (error) {
    console.warn(`[redis.ts] Failed to set expiration on key ${key}:`, error);
  }

  // Fallback to memory cache
  const cached = memoryCache.get(key);
  if (cached) {
    cached.expireAt = Date.now() + expirationSeconds * 1000;
    memoryCache.set(key, cached);
    return true;
  }

  return false;
}


/**
 * Get current Redis status
 * Used for health checks and diagnostics
 */
export async function getRedisStatus(): Promise<{ available: boolean; source: 'redis' | 'memory' }> {
  const redis = initializeRedis();

  if (!redis) {
    return { available: true, source: 'memory' };
  }

  try {
    if (redisAvailable === null) {
      // Try a simple ping to verify connection
      await redis.ping();
      redisAvailable = true;
    }
    return { available: true, source: 'redis' };
  } catch (error) {
    console.warn('[redis.ts] Redis health check failed:', error);
    redisAvailable = false;
    return { available: false, source: 'redis' };
  }
}

