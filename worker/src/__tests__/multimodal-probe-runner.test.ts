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
