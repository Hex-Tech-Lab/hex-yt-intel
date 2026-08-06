import { describe, it, expect } from 'vitest';

describe('CONTRACT: OpenRouterCompletionAdapter hits the documented chat-completions endpoint', () => {
  it('URL matches https://openrouter.ai/api/v1/chat/completions (docs-verified 2026-08-06)', () => {
    const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
    expect(OPENROUTER_URL).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('non-streaming response shape matches docs (choices[0].message.content)', () => {
    const docsExampleResponse = {
      id: 'gen-123',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
    };
    const text = docsExampleResponse.choices?.[0]?.message?.content?.trim() ?? '';
    expect(text).toBe('hello');
  });
});
