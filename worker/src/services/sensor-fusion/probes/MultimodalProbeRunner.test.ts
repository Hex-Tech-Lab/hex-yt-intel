import { describe, it, expect, vi, afterEach } from 'vitest';

import { MultimodalProbeRunner } from './MultimodalProbeRunner';

// Endpoint contract: OpenRouter chat completions is called with POST, the
// X-Title attribution header, and a body carrying model + messages.
describe('MultimodalProbeRunner endpoint contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to chat/completions with X-Title, model and messages in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', fetchMock);

    const runner = new MultimodalProbeRunner({ apiKey: 'test-key', model: 'test/probe-model' });
    await runner
      .inspectVideoChunks('vid1', [{ chunkIndex: 0, startTimeSeconds: 0, mediaUrl: 'https://example.com/a.mp4' }])
      .catch(() => undefined);

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Title']).toBe('vIntel - Multimodal Probe Runner');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('test/probe-model');
    expect(Array.isArray(body.messages)).toBe(true);
  });
});
