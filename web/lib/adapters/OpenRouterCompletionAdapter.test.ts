/**
 * CONTRACT: OpenRouterCompletionAdapter hits the documented chat-completions
 * endpoint. Rewritten 2026-08-06: mocks global.fetch, calls the real
 * OpenRouterCompletionAdapter.complete(), asserts the real request and the
 * real cascade-fallback behavior (first non-empty completion wins).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { openrouterApiKey: 'test-key' } }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { OpenRouterCompletionAdapter } from './OpenRouterCompletionAdapter';

describe('OpenRouterCompletionAdapter.complete', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to https://openrouter.ai/api/v1/chat/completions with the real system/user messages and model', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => ({ choices: [{ message: { content: 'hello world' } }] }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenRouterCompletionAdapter();
    const result = await adapter.complete({
      system: 'sys prompt',
      user: 'user prompt',
      models: [{ model: 'anthropic/claude-haiku-4.5' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('anthropic/claude-haiku-4.5');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
    expect(result).toEqual({ text: 'hello world', model: 'anthropic/claude-haiku-4.5' });
  });

  it('falls through to the next cascade model when the first returns an empty completion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => ({ choices: [{ message: { content: '' } }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => ({ choices: [{ message: { content: 'fallback text' } }] }) } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenRouterCompletionAdapter();
    const result = await adapter.complete({
      system: 's',
      user: 'u',
      models: [{ model: 'model/a' }, { model: 'model/b' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.model).toBe('model/b');
    expect(result.text).toBe('fallback text');
  });

  it('throws after all cascade models fail with a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenRouterCompletionAdapter();
    await expect(
      adapter.complete({ system: 's', user: 'u', models: [{ model: 'model/a' }] }),
    ).rejects.toThrow(/OpenRouter 500/);
  });
});
