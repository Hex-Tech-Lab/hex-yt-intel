import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MultimodalProbeRunner,
  type MultimodalRunnerConfig,
} from '../services/sensor-fusion/probes/MultimodalProbeRunner';

describe('MultimodalProbeRunner (Phase 2 Sensor Fusion)', () => {
  const config: MultimodalRunnerConfig = {
    apiKey: 'test-openrouter-key',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'test/probe-model',
    timeoutMs: 500,
  };

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws error when apiKey is missing', () => {
    expect(() => new MultimodalProbeRunner({ apiKey: '' })).toThrow(/API key is required/);
  });

  it('throws error when probe model is missing (no silent remote-model default, ADR 041)', () => {
    expect(() => new MultimodalProbeRunner({ apiKey: 'test-openrouter-key' })).toThrow(/Probe model is required/);
  });

  it('sends the trimmed model id to the provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({ uiFramesDetected: false, debateProsodyDetected: false, visibleSpeakerCount: 1, confidence: 0.9 }),
              },
            },
          ],
        }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const runner = new MultimodalProbeRunner({ ...config, model: '  test/probe-model  ' });
    await runner.inspectVideoChunks('vid-trim', [
      { chunkIndex: 0, startTimeSeconds: 0, mediaUrl: 'https://r2.hex-yt-intel/c0.mp4' },
    ]);

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as { model: string };
    expect(body.model).toBe('test/probe-model');
  });

  it('fails closed on schema-invalid model output instead of coercing false/0', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: JSON.stringify({ visibleSpeakerCount: 1, confidence: 0.9 }) } }],
        }),
    } as Response);

    const runner = new MultimodalProbeRunner(config);
    await expect(
      runner.inspectVideoChunks('vid-bad-schema', [
        { chunkIndex: 0, startTimeSeconds: 0, mediaUrl: 'https://r2.hex-yt-intel/c0.mp4' },
      ]),
    ).rejects.toThrow(/schema-invalid/);
  });

  it('does not report an empty probe row as degraded-failure (already-fixed check)', async () => {
    const runner = new MultimodalProbeRunner(config);
    const result = await runner.inspectVideoChunks('vid-empty', []);
    expect(result.summary.uiFramesDetected).toBe(false);
  });

  it('truncates upstream error bodies echoed into the thrown probe error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('x'.repeat(5000)),
    } as Response);

    const runner = new MultimodalProbeRunner(config);
    const error = await runner
      .inspectVideoChunks('vid-truncate', [
        { chunkIndex: 0, startTimeSeconds: 0, mediaUrl: 'https://r2.hex-yt-intel/c0.mp4' },
      ])
      .catch((err: Error) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error.message.length).toBeLessThan(3000);
    expect(error.message).toContain('Multimodal probe HTTP 500');
  });

  it('returns default empty summary when no chunks provided', async () => {
    const runner = new MultimodalProbeRunner(config);
    const result = await runner.inspectVideoChunks('vid-empty', []);

    expect(result.videoId).toBe('vid-empty');
    expect(result.chunks).toEqual([]);
    expect(result.summary.uiFramesDetected).toBe(false);
    expect(result.summary.debateProsodyDetected).toBe(false);
  });

  it('inspects chunk and extracts structured schema output', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              uiFramesDetected: true,
              debateProsodyDetected: false,
              visibleSpeakerCount: 1,
              confidence: 0.95,
            }),
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const runner = new MultimodalProbeRunner(config);
    const result = await runner.inspectVideoChunks('vid-code-tutorial', [
      { chunkIndex: 0, startTimeSeconds: 90, mediaUrl: 'https://r2.hex-yt-intel/chunk0.mp4' },
    ]);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.uiFramesDetected).toBe(true);
    expect(result.chunks[0]?.visibleSpeakerCount).toBe(1);
    expect(result.summary.uiFramesDetected).toBe(true);
    expect(result.summary.debateProsodyDetected).toBe(false);
  });

  it('fails closed when API request hangs past timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_requestUrl, options) => {
      return new Promise((resolvePromise, rejectPromise) => {
        options?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          rejectPromise(err);
        });
      });
    });

    const runner = new MultimodalProbeRunner({ ...config, timeoutMs: 50 });
    await expect(
      runner.inspectVideoChunks('vid-hang', [
        { chunkIndex: 0, startTimeSeconds: 30, mediaUrl: 'https://r2.hex-yt-intel/hang.mp4' },
      ]),
    ).rejects.toThrow(/timed out after 50ms/);
  });
});
