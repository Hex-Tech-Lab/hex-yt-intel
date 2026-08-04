import { vi, beforeEach, afterAll } from 'vitest';

/**
 * tryConsumeTokenBucket's real logic lives in a Lua script (TOKEN_BUCKET_SCRIPT
 * in web/lib/redis.ts), executed server-side by Redis via EVAL -- it can't run
 * in a JS test process directly. Mocking eval()'s return value with a hardcoded
 * 0/1 (the previous version of this test) never exercises the actual capacity/
 * refill/cost math -- every assertion just proved the mock returns what it was
 * told to return.
 *
 * Fix: mock executeRedisScript (the layer above the raw Redis client) with a
 * faithful JS reimplementation of TOKEN_BUCKET_SCRIPT's algorithm, backed by
 * real per-key state that persists across calls within a test -- the same
 * pattern already established in rate-limit-sliding-window.test.ts for the
 * sibling sliding-window Lua script. This exercises real stateful behavior
 * (refill across a period boundary, self-correcting clamp-down, consecutive
 * consumption) instead of canned single-call outputs. If TOKEN_BUCKET_SCRIPT's
 * Lua source changes, this mock must be updated to match -- it is a
 * reimplementation, not the real script, so it can drift; keep both files'
 * algorithm comments in sync.
 */
interface BucketState {
  tokens: number;
  lastResetAt: number;
}

const mockRedisStore = new Map<string, BucketState>();

function simulateTokenBucketScript(
  key: string,
  capacity: number,
  periodAnchorMs: number,
  now: number,
  cost: number
): 0 | 1 {
  const existing = mockRedisStore.get(key);
  let tokens = existing?.tokens;
  let lastResetAt = existing?.lastResetAt;

  if (tokens === undefined || lastResetAt === undefined || lastResetAt < periodAnchorMs) {
    tokens = capacity;
    if (capacity > 0) {
      lastResetAt = now;
    } else {
      // Fail-closed: leave lastResetAt at its stale value (or unset) so the
      // NEXT call still sees lastResetAt < periodAnchorMs and retries the
      // reset, instead of permanently zeroing the budget for the period.
      lastResetAt = lastResetAt ?? -Infinity;
    }
  } else {
    tokens = Math.min(tokens, capacity);
  }

  if (tokens >= cost) {
    tokens -= cost;
    mockRedisStore.set(key, { tokens, lastResetAt });
    return 1;
  }

  mockRedisStore.set(key, { tokens, lastResetAt });
  return 0;
}

// Must mock @upstash/redis (the actual module boundary), not @/lib/redis
// itself -- tryConsumeTokenBucket calls executeRedisScript as a same-module
// internal function reference, not through the module's exported binding, so
// mocking @/lib/redis's own export doesn't intercept that internal call.
process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

vi.mock('@upstash/redis', () => ({
  Redis: class {
    async eval(_script: string, keys: string[], args: (string | number)[]) {
      const [capacity, periodAnchorMs, now, cost] = args as number[];
      return simulateTokenBucketScript(keys[0]!, capacity!, periodAnchorMs!, now!, cost!);
    }
  },
}));

const { tryConsumeTokenBucket } = await import('@/lib/redis');

describe('tryConsumeTokenBucket', () => {
  const periodAnchorMs = 1000;

  beforeEach(() => {
    mockRedisStore.clear();
  });

  afterAll(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('allows consumption when the bucket has sufficient capacity', async () => {
    const key = 'test:bucket:sufficient';
    const result = await tryConsumeTokenBucket(key, 10, periodAnchorMs, 1);
    expect(result).toBe(true);
    expect(mockRedisStore.get(key)?.tokens).toBe(9);
  });

  it('refills to full capacity on first use in a new period', async () => {
    const key = 'test:bucket:first-use';
    // Simulate a stale entry from a previous period.
    mockRedisStore.set(key, { tokens: 0, lastResetAt: periodAnchorMs - 1 });
    const result = await tryConsumeTokenBucket(key, 5, periodAnchorMs, 2);
    expect(result).toBe(true);
    expect(mockRedisStore.get(key)?.tokens).toBe(3);
  });

  it('does not refill mid-period -- tokens carry over from the last call', async () => {
    const key = 'test:bucket:no-mid-period-refill';
    await tryConsumeTokenBucket(key, 5, periodAnchorMs, 3); // 5 -> 2
    const result = await tryConsumeTokenBucket(key, 5, periodAnchorMs, 3); // needs 3, only 2 left
    expect(result).toBe(false);
    expect(mockRedisStore.get(key)?.tokens).toBe(2);
  });

  it('self-corrects downward when capacity shrinks mid-period without resetting', async () => {
    const key = 'test:bucket:capacity-shrink';
    await tryConsumeTokenBucket(key, 10, periodAnchorMs, 1); // tokens = 9
    // Capacity drops to 5 on the next call, same period -- should clamp to
    // min(9, 5) = 5, NOT refill back to a fresh 10.
    const result = await tryConsumeTokenBucket(key, 5, periodAnchorMs, 4);
    expect(result).toBe(true);
    expect(mockRedisStore.get(key)?.tokens).toBe(1); // min(9,5) - 4
  });

  it('rejects consumption exceeding remaining capacity', async () => {
    const key = 'test:bucket:reject-over';
    const result = await tryConsumeTokenBucket(key, 10, periodAnchorMs, 11);
    expect(result).toBe(false);
    expect(mockRedisStore.get(key)?.tokens).toBe(10); // unchanged, denied call doesn't consume
  });

  it('fails closed on zero capacity and does not commit a reset (retries next call)', async () => {
    const key = 'test:bucket:zero-capacity';
    const result = await tryConsumeTokenBucket(key, 0, periodAnchorMs, 1);
    expect(result).toBe(false);
    // lastResetAt stays stale (-Infinity here, unset before) so a later call
    // with real capacity still sees lastResetAt < periodAnchorMs and resets.
    expect(mockRedisStore.get(key)?.lastResetAt).toBeLessThan(periodAnchorMs);
  });

  it('handles consecutive consumption until exhaustion (real per-call state, not test-tracked)', async () => {
    const key = 'test:bucket:consecutive';
    expect(await tryConsumeTokenBucket(key, 3, periodAnchorMs, 1)).toBe(true);
    expect(await tryConsumeTokenBucket(key, 3, periodAnchorMs, 1)).toBe(true);
    expect(await tryConsumeTokenBucket(key, 3, periodAnchorMs, 1)).toBe(true);
    expect(await tryConsumeTokenBucket(key, 3, periodAnchorMs, 1)).toBe(false);
    expect(mockRedisStore.get(key)?.tokens).toBe(0);
  });

  it('handles fractional cost values against real remaining balance', async () => {
    const key = 'test:bucket:fractional';
    await tryConsumeTokenBucket(key, 1, periodAnchorMs, 0.7);
    const result = await tryConsumeTokenBucket(key, 1, periodAnchorMs, 0.5);
    expect(result).toBe(false); // 1 - 0.7 = 0.3, insufficient for 0.5
    expect(mockRedisStore.get(key)?.tokens).toBeCloseTo(0.3);
  });
});
