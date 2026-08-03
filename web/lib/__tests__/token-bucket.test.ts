import { vi, beforeEach } from 'vitest';

/**
 * Test tryConsumeTokenBucket by mocking @upstash/redis (the lowest layer).
 * initializeRedis() checks for UPSTASH_REDIS_REST_URL/TOKEN env vars and
 * returns null if unset — we must provide them so it constructs a real
 * client, then mock that client's eval method to control the Lua result.
 */
const mockEval = vi.fn<() => 0 | 1>();

vi.mock('@upstash/redis', () => ({
  Redis: class {
    eval() { return mockEval(); }
  },
}));

const { tryConsumeTokenBucket } = await import('@/lib/redis');

describe('tryConsumeTokenBucket', () => {
  const key = 'test:bucket:user-1';
  const capacity = 10;
  const periodAnchorMs = 1000;
  const cost = 1;

  beforeEach(() => {
    mockEval.mockReset();
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';
  });

  afterAll(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('returns true when bucket has sufficient tokens', async () => {
    mockEval.mockResolvedValue(1);
    const result = await tryConsumeTokenBucket(key, capacity, periodAnchorMs, cost);
    expect(result).toBe(true);
  });

  it('returns false when bucket is exhausted', async () => {
    mockEval.mockResolvedValue(0);
    const result = await tryConsumeTokenBucket(key, capacity, periodAnchorMs, cost);
    expect(result).toBe(false);
  });

  it('accepts cost equal to full capacity', async () => {
    mockEval.mockResolvedValue(1);
    const result = await tryConsumeTokenBucket(key, capacity, periodAnchorMs, capacity);
    expect(result).toBe(true);
  });

  it('rejects cost exceeding capacity', async () => {
    mockEval.mockResolvedValue(0);
    const result = await tryConsumeTokenBucket(key, capacity, periodAnchorMs, capacity + 1);
    expect(result).toBe(false);
  });

  it('handles zero capacity (fail-closed)', async () => {
    mockEval.mockResolvedValue(0);
    const result = await tryConsumeTokenBucket(key, 0, periodAnchorMs, cost);
    expect(result).toBe(false);
  });

  it('handles consecutive consumption until exhaustion', async () => {
    let remaining = 3;
    mockEval.mockImplementation(() => {
      if (remaining > 0) { remaining -= cost; return 1; }
      return 0;
    });

    expect(await tryConsumeTokenBucket(key, 3, periodAnchorMs, 1)).toBe(true);
    expect(await tryConsumeTokenBucket(key, 3, periodAnchorMs, 1)).toBe(true);
    expect(await tryConsumeTokenBucket(key, 3, periodAnchorMs, 1)).toBe(true);
    expect(await tryConsumeTokenBucket(key, 3, periodAnchorMs, 1)).toBe(false);
  });

  it('handles fractional cost values', async () => {
    mockEval.mockResolvedValue(1);
    const result = await tryConsumeTokenBucket(key, 10, periodAnchorMs, 0.5);
    expect(result).toBe(true);
  });
});