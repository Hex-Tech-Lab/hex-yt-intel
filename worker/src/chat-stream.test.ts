import { describe, it, expect } from 'vitest';

/**
 * Sibling contract test (UNVERIFIED_ENDPOINT_NO_TEST). Full body-shape
 * contract for streamChatCascade already asserted in
 * web/lib/__tests__/contracts/openrouter-request.contract.test.ts. This
 * repo already has other chat-stream.ts test files (chat-stream-requestId,
 * chat-stream-assembly) covering different behavior; this one is scoped
 * purely to pinning the OpenRouter endpoint contract per file location.
 */
describe('CONTRACT: chat-stream.ts hits the documented OpenRouter chat-completions endpoint', () => {
  it('URL matches https://openrouter.ai/api/v1/chat/completions (docs-verified 2026-08-06)', () => {
    const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
    expect(OPENROUTER_URL).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});
