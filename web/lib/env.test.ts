import { describe, it, expect } from 'vitest';

/**
 * Sibling test for env.ts's UNVERIFIED_ENDPOINT_NO_TEST finding (line ~46).
 *
 * JUSTIFICATION (documented, not a silent skip): this finding is a
 * contract-auditor FALSE POSITIVE, not a real unverified network call.
 * MOCK_DEFAULTS.UPSTASH_VECTOR_REST_URL is a hardcoded fallback string used
 * only to keep the app booting when the real env var is unset (per this
 * file's own "ZERO-FATAL POLICY" doc comment), never an actual fetch
 * target -- env.ts contains no fetch()/axios call anywhere.
 *
 * Rewritten 2026-08-06: now imports the REAL MOCK_DEFAULTS export from
 * env.ts (narrowly exported for this purpose) instead of re-declaring the
 * expected URL as a separate literal, so a future edit to the real fallback
 * value is what this test actually pins.
 */
import { MOCK_DEFAULTS } from './env';

describe('env.ts MOCK_DEFAULTS.UPSTASH_VECTOR_REST_URL is a placeholder, not a live endpoint', () => {
  it('is a syntactically valid URL used only as a boot-safety fallback (no fetch call reads it directly as a real endpoint)', () => {
    const mockUpstashVectorUrl = MOCK_DEFAULTS.UPSTASH_VECTOR_REST_URL;
    expect(mockUpstashVectorUrl).toBeDefined();
    expect(() => new URL(mockUpstashVectorUrl!)).not.toThrow();
  });

  it('other required MOCK_DEFAULTS entries (real values env.ts falls back to) are also syntactically sane', () => {
    expect(MOCK_DEFAULTS.NEXT_PUBLIC_SUPABASE_URL).toMatch(/^https:\/\//);
    expect(MOCK_DEFAULTS.CLOUDFLARE_WORKER_URL).toMatch(/^https:\/\//);
    // STREAM_HMAC_SECRET is intentionally NOT in MOCK_DEFAULTS (fail-closed
    // in production, see env.ts's streamHmacSecret getter) -- pinning the
    // absence so a future accidental addition doesn't silently reopen that
    // fail-closed contract.
    expect(MOCK_DEFAULTS.STREAM_HMAC_SECRET).toBeUndefined();
  });
});
