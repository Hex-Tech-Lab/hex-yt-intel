/**
 * CONTRACT: openrouter.ts (callOpenRouter) hits the documented OpenRouter
 * chat-completions endpoint with the real request body and real
 * quota-cascade fallback behavior. Rewritten 2026-08-06: mocks
 * global.fetch + the prompt/cascade dependencies, calls the real exported
 * callOpenRouter.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prompts/factory', () => ({ getUCISPrompt: vi.fn().mockResolvedValue('built prompt') }));
vi.mock('@/lib/config/cascade', () => ({
  resolveAnalysisCascade: vi.fn().mockResolvedValue([{ model: 'model/a', cost: 0.001 }, { model: 'model/b', cost: 0.002 }]),
}));

import { callOpenRouter, AnalysisEngineError } from './openrouter';

const metadata = { title: 't', channelTitle: 'c', publishedAt: '', viewCount: '0', likeCount: '0', commentCount: '0', duration: 0 } as any;

describe('callOpenRouter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENROUTER_API_KEY;
  });

  it('POSTs to the real chat-completions endpoint with the real translated model id and streaming body', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await callOpenRouter(metadata, 'transcript text', 'creator', 'UTC');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('model/a');
    expect(body.stream).toBe(true);
    expect(body.messages[0].content).toBe('built prompt');
  });

  it('cascades to the next tier on a 429 quota signal, and stamps the winning tier onto x-model-meta', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: () => 'rate limited' } as Response)
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await callOpenRouter(metadata, 'transcript text', 'creator', 'UTC');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).model).toBe('model/b');
    const meta = JSON.parse(response.headers.get('x-model-meta')!);
    expect(meta.model).toBe('model/b');
  });

  it('throws AnalysisEngineError with ERR_PROVIDER_QUOTA_EXHAUSTED after the whole cascade returns 402/429', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 402, text: () => 'payment required' } as Response),
    );

    await expect(callOpenRouter(metadata, 'transcript text', 'creator', 'UTC')).rejects.toMatchObject({
      code: 'ERR_PROVIDER_QUOTA_EXHAUSTED',
    });
  });

  it('throws immediately if OPENROUTER_API_KEY is missing, without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(callOpenRouter(metadata, 't', 'creator', 'UTC')).rejects.toThrow('OPENROUTER_API_KEY missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AnalysisEngineError (kept for regression coverage)', () => {
  it('carries code/statusCode/modelAttempted', () => {
    const err = new AnalysisEngineError({ message: 'm', code: 'C', statusCode: 502, modelAttempted: 'x' });
    expect(err.code).toBe('C');
    expect(err.statusCode).toBe(502);
  });
});
