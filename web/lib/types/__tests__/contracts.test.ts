/**
 * Contract test for the WorkerStreamRequest forwarding fields (prompt
 * caching, 2026-09-25): promptCaching/cacheWarmTimeoutMs are registry-resolved
 * client-side config forwarded to the worker per-request. They are pure
 * performance/config toggles -- NOT authorization-sensitive (the stream
 * request's real security boundary is the HMAC sig/exp token, unchanged
 * here), so this test pins that they exist and stay optional rather than
 * guarding any auth branch.
 */
import { describe, it, expect } from 'vitest';
import type { WorkerStreamRequest } from '@/lib/types/contracts';

describe('WorkerStreamRequest prompt-caching forwarding fields', () => {
  it('promptCaching and cacheWarmTimeoutMs are optional and default-absent (stale clients unaffected)', () => {
    const base: WorkerStreamRequest = {
      videoId: 'dQw4w9WgXcQ',
      analysisId: 'analysis-1',
      transcript: 't',
      metadata: { title: 't' } as WorkerStreamRequest['metadata'],
      persona: 'creator',
      timezone: 'UTC',
      sig: 'sig',
      exp: 123,
    };
    expect(base.promptCaching).toBeUndefined();
    expect(base.cacheWarmTimeoutMs).toBeUndefined();

    const withCaching: WorkerStreamRequest = { ...base, promptCaching: true, cacheWarmTimeoutMs: 3000 };
    expect(withCaching.promptCaching).toBe(true);
    expect(withCaching.cacheWarmTimeoutMs).toBe(3000);
  });
});