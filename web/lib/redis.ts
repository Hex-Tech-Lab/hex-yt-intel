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
import * as Sentry from '@sentry/nextjs';

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

  // Type guard: ensure both credentials are present before proceeding
  if (typeof redisUrl !== 'string' || typeof redisToken !== 'string') {
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
    // Any runtime Redis failure (WRONGPASS, connection error, etc.)
    // must disable Redis for all subsequent calls in this process so
    // they use the in-memory cache without repeated failed lookups.
    console.warn(`[redis.ts] Failed to get key ${key}:`, error);
    redisAvailable = false;
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
    redisAvailable = false;
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
    redisAvailable = false;
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
      const result =       await redis.expire(key, expirationSeconds);
      return result === 1; // 1 = success, 0 = key doesn't exist
    }
  } catch (error) {
    console.warn(`[redis.ts] Failed to set expiration on key ${key}:`, error);
    redisAvailable = false;
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
 * Execute Lua script against Redis with exponential backoff retry
 * Used for atomic multi-step operations (e.g., sliding window rate limiting)
 *
 * Circuit breaker: Implements 3 retries with exponential backoff (100ms, 200ms, 400ms)
 * to handle transient network spikes on Serverless edge environments
 */
export async function executeRedisScript(
  script: string,
  keys: string[],
  args: (string | number)[]
): Promise<any> {
  const redis = initializeRedis();

  if (!redis || !redisAvailable) {
    // Redis not configured or already marked unavailable
    return -1;
  }

  const maxRetries = 3;
  const baseDelayMs = 100;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await redis.eval(script, keys, args);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is a transient error (not auth/invalid command)
      const errorMsg = lastError.message.toLowerCase();
      const isTransient =
        errorMsg.includes('timeout') ||
        errorMsg.includes('econnreset') ||
        errorMsg.includes('econnrefused') ||
        errorMsg.includes('etimedout');

      // Only retry on transient errors, fail immediately on permanent errors
      if (!isTransient) {
        console.warn('[redis.ts] Permanent Redis error, marking unavailable:', lastError.message);
        redisAvailable = false;
        return -1;
      }

      // Exponential backoff: 100ms, 200ms, 400ms
      if (attempt < maxRetries - 1) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(
          `[redis.ts] Transient Redis error (attempt ${attempt + 1}/${maxRetries}), ` +
          `retrying in ${delayMs}ms:`,
          lastError.message
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // All retries exhausted
  console.warn(
    `[redis.ts] Failed to execute Lua script after ${maxRetries} attempts:`,
    lastError?.message
  );
  redisAvailable = false;
  return -1;
}

/**
 * Delete a key from Redis
 */
export async function deleteRedisKey(key: string): Promise<void> {
  const redis = initializeRedis();

  try {
    if (redis && redisAvailable) {
      await redis.del(key);
      return;
    }
  } catch (error) {
    console.warn(`[redis.ts] Failed to delete key ${key}:`, error);
    redisAvailable = false;
  }

  memoryCache.delete(key);
}

/**
 * Acquire a distributed lock via atomic SET-if-not-exists-with-TTL. Used to
 * serialize a run-level operation (e.g. a cron harness) across overlapping
 * invocations -- unlike setRedisValue (plain SET, always overwrites), this
 * only succeeds if no other holder currently owns the key, so exactly one
 * concurrent caller ever acquires it. Falls back to a per-process in-memory
 * lock when Redis is unavailable (best-effort only in that case -- does not
 * protect against overlap across separate serverless instances).
 *
 * Returns a unique per-acquisition token (not a plain boolean) that MUST be
 * passed to releaseRedisLock. Without this, a holder whose TTL expired mid-
 * run could unconditionally delete a DIFFERENT, newer holder's live lock on
 * its own (late) release -- exactly re-opening the overlap this primitive
 * exists to prevent. The token makes release a compare-and-delete: only the
 * current owner's release actually clears the key.
 */
export async function acquireRedisLock(key: string, ttlSeconds: number): Promise<string | null> {
  const redis = initializeRedis();
  const token = crypto.randomUUID();

  // Attempt Redis on every operation instead of relying solely on sticky gate
  if (redis) {
    try {
      const result = await redis.set(key, token, { nx: true, ex: ttlSeconds });
      return result === 'OK' ? token : null;
    } catch (error) {
      console.warn('[redis.ts] Failed to acquire lock', { key, error: error instanceof Error ? error.message : String(error) });
      redisAvailable = false;
      // Fall through to in-memory fallback below
    }
  }

  // Degraded path: Redis is down, falling back to a per-process lock that
  // does NOT protect against overlap across separate serverless instances.
  // Surfaced to Sentry (not just console.warn) because this silently
  // weakens whatever correctness guarantee the caller was relying on the
  // lock for -- worth knowing about even though the harness's own guarded
  // write is still a backstop against actual data corruption.
  console.warn('[redis.ts] Redis unavailable, using in-memory lock fallback -- NOT cross-instance safe', { lockKey: key });
  Sentry.captureMessage('acquireRedisLock: degraded to in-memory fallback', {
    level: 'warning',
    tags: { lockKey: key },
  });

  const existing = memoryCache.get(key);
  if (existing && existing.expireAt > Date.now()) return null;
  memoryCache.set(key, { value: token, expireAt: Date.now() + ttlSeconds * 1000 });
  return token;
}

/**
 * Release a lock acquired via acquireRedisLock. Compare-and-delete on the
 * token returned by acquireRedisLock -- NOT a plain delete. A plain delete
 * would let a holder whose TTL already expired (e.g. a run that overran
 * HARNESS_LOCK_TTL_SECONDS) delete a completely different, newer holder's
 * still-live lock when it finally gets around to releasing, defeating the
 * whole point of the lock. The Lua script makes the read-then-delete
 * atomic; a plain GET-then-DEL from application code would itself have a
 * race window between the two calls.
 */
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export async function releaseRedisLock(key: string, token: string): Promise<void> {
  const redis = initializeRedis();

  // Attempt Redis compare-and-delete on every operation to avoid leaking
  // Redis-acquired locks into in-memory fallback path
  if (redis) {
    try {
      await executeRedisScript(RELEASE_IF_OWNER_SCRIPT, [key], [token]);
      return;
    } catch (error) {
      console.warn('[redis.ts] Failed to release Redis lock', { key, error: error instanceof Error ? error.message : String(error) });
      redisAvailable = false;
      // Fall through to in-memory fallback below
    }
  }

  // Memory fallback: only clear if we're still the recorded owner.
  const existing = memoryCache.get(key);
  if (existing && existing.value === token) {
    memoryCache.delete(key);
  }
}

/**
 * Atomic token-bucket check-and-deduct, denominated in whatever integer
 * unit the caller chooses (USD cents for remediation's budget -- see ADR
 * 019, docs/specs/ADR_019_REMEDIATION_BUDGET_TOKEN_BUCKET_2026-07-31.md).
 *
 * Calendar-boundary hard reset (user decision, 2026-08-01): `periodAnchorMs`
 * is the start of the caller's current billing period (e.g. midnight UTC on
 * the 1st of the month) -- the bucket fills to full `capacity` exactly once,
 * on the first call after crossing that boundary, then only drains until
 * the next one. No linear/continuous refill within a period (the original
 * design refilled smoothly over `periodDays`, but that let the bucket drain
 * near-zero early and never meaningfully recover before the next reset).
 * `capacity` may still change between calls within a period (the caller
 * recomputes it from a live external balance) -- stored tokens clamp DOWN
 * to a shrinking capacity, but never grow back up until the next period
 * boundary.
 *
 * Fails CLOSED: any Redis failure (executeRedisScript's `-1` sentinel) is
 * treated as "deny the spend", never "assume unlimited budget". This is a
 * money-gating primitive, not a cache -- the failure mode has to be the
 * conservative one.
 */
// Calendar-boundary hard reset (user decision, 2026-08-01), not a continuous
// rolling-window refill -- the bucket fills to full capacity exactly once,
// the moment the FIRST call after a period boundary (periodAnchorMs) lands,
// then only drains until the next boundary. No partial/linear refill within
// a period. Replaced the previous linear elapsed-time refill because that
// model let the bucket drain to near-zero on day 1 and never meaningfully
// recover before the next reset -- see dimension-remediation.ts's
// resolveBudgetParams for how periodAnchorMs is computed (start of the
// current calendar month).
const TOKEN_BUCKET_SCRIPT = `
local bucket = redis.call("HMGET", KEYS[1], "tokens", "lastResetAt")
local tokens = tonumber(bucket[1])
local lastResetAt = tonumber(bucket[2])
local capacity = tonumber(ARGV[1])
local periodAnchorMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

if tokens == nil or lastResetAt == nil or lastResetAt < periodAnchorMs then
  tokens = capacity
  lastResetAt = now
else
  -- No refill within a period, but still self-correct DOWN if capacity
  -- shrank since the last call (capacity is recomputed live from
  -- OpenRouter's remaining balance every tick) -- preserves the original
  -- script's over-capacity clamp without reintroducing linear refill.
  tokens = math.min(tokens, capacity)
end

if tokens >= cost then
  tokens = tokens - cost
  redis.call("HMSET", KEYS[1], "tokens", tostring(tokens), "lastResetAt", tostring(lastResetAt))
  redis.call("EXPIRE", KEYS[1], 5184000)
  return 1
end

redis.call("HMSET", KEYS[1], "tokens", tostring(tokens), "lastResetAt", tostring(lastResetAt))
redis.call("EXPIRE", KEYS[1], 5184000)
return 0
`;

export async function tryConsumeTokenBucket(
  key: string,
  capacity: number,
  periodAnchorMs: number,
  cost: number
): Promise<boolean> {
  const result = await executeRedisScript(
    TOKEN_BUCKET_SCRIPT,
    [key],
    [capacity, periodAnchorMs, Date.now(), cost]
  );
  return result === 1;
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

