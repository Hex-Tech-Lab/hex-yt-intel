import { describe, it, expect, vi, afterEach } from 'vitest';

import { JevTextParser } from './jev-text-parser';

// Endpoint contract: the Jev Decisions API is called with POST, the X-Title
// attribution header, and a body carrying the model and the text state.
describe('JevTextParser endpoint contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the Decisions endpoint with X-Title and model in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const parser = new JevTextParser('test-key');
    await parser.scoreChunk('>> Hello there').catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Title']).toBe('vIntel - Jev Text Heuristics');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('~typesafe/jev-latest');
    expect(body.state).toEqual({ text: '>> Hello there' });
    expect(body).toHaveProperty('questions');
  });
});
