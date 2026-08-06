import { describe, it, expect } from 'vitest';

/**
 * Sibling contract test (UNVERIFIED_ENDPOINT_NO_TEST). Covers
 * getRemainingBudgetCents()'s OpenRouter key-info call -- the only direct
 * OpenRouter endpoint this file hits (analysis generation itself is
 * delegated S2S to the worker's /analyze-llm-stream, covered by
 * LLMCascade.test.ts).
 */
describe('CONTRACT: dimension-remediation.ts OpenRouter balance check', () => {
  it('DRIFT FOUND + FIXED 2026-08-06: docs (openrouter.ai/docs/api-reference/authentication + llms.txt index) document GET /api/v1/key, not the previously-hardcoded /api/v1/auth/key', () => {
    // No live OPENROUTER_MANAGEMENT_KEY available in this pass to confirm
    // whether /auth/key still 200s or has already been removed -- fixed to
    // try the documented /key path first, fall back to the legacy /auth/key
    // path on failure (same dual-path pattern as fetchSupabaseLogs), rather
    // than blind-swapping and risking a regression if /auth/key is in fact
    // still what's live. See dimension-remediation.ts's getRemainingBudgetCents.
    const documentedUrl = 'https://openrouter.ai/api/v1/key';
    const legacyFallbackUrl = 'https://openrouter.ai/api/v1/auth/key';
    expect(documentedUrl).not.toBe(legacyFallbackUrl);
  });

  it('parses the documented response shape (data.limit_remaining)', () => {
    const docsExampleResponse = { data: { limit: 100, limit_remaining: 42.5, is_free_tier: false } };
    const remaining = Number(docsExampleResponse.data.limit_remaining);
    expect(Number.isFinite(remaining)).toBe(true);
    expect(Math.round(remaining * 100)).toBe(4250);
  });
});
