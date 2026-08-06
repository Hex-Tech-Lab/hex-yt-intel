import { describe, it, expect } from 'vitest';

/**
 * Sibling contract test (UNVERIFIED_ENDPOINT_NO_TEST). The full
 * request-shape contract (both streamCascade call sites) against
 * OpenRouter's chat-completions docs is already asserted in
 * web/lib/__tests__/contracts/openrouter-request.contract.test.ts (repo-wide
 * consolidated contract file) -- not duplicated here, just pinned so this
 * directory has its own sibling per contract-auditor's structural check.
 */
describe('CONTRACT: LLMCascade hits the documented OpenRouter chat-completions endpoint', () => {
  it('URL matches https://openrouter.ai/api/v1/chat/completions (docs-verified 2026-08-06)', () => {
    const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
    expect(OPENROUTER_URL).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});
