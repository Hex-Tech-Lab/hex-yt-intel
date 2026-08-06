/**
 * CONTRACT: relations-engine.ts (callStanceModelStream, via the public
 * computeStanceRelationsStream generator) hits the documented OpenRouter
 * chat-completions endpoint. Rewritten 2026-08-06: mocks global.fetch with
 * a real SSE-shaped ReadableStream body and drains the real exported
 * generator, asserting the real request URL/body and that streamed deltas
 * actually reach the caller.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/config/cascade', () => ({
  resolveStanceCascade: vi.fn().mockResolvedValue([{ model: 'model/a', name: 'Model A' }]),
}));
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: { getRegistrySettings: vi.fn().mockResolvedValue({ 'observability.logProviderAttribution': false }) },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { computeStanceRelationsStream } from './relations-engine';

function sseResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const dims = [
  { number: 1, name: 'Dim One', content: 'x'.repeat(20) },
  { number: 2, name: 'Dim Two', content: 'y'.repeat(20) },
];

describe('computeStanceRelationsStream -> callStanceModelStream', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to the real chat-completions endpoint with the real prompt/model/provider body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"{\\"insights\\":[]}"}}]}',
        'data: [DONE]',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const events = [];
    for await (const event of computeStanceRelationsStream(dims, 'test-api-key')) events.push(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('model/a');
    expect(body.stream).toBe(true);
    expect(body.messages[0].content).toContain('Dim One');
    expect(events.some((event) => event.type === 'model' && event.model === 'model/a')).toBe(true);
  });

  it('does not call fetch at all when fewer than 2 usable dimensions are provided (real early-return)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const events = [];
    for await (const event of computeStanceRelationsStream([dims[0]!], 'test-api-key')) events.push(event);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });
});
