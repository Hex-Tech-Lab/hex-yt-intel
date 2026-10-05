import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DeepgramNova2Adapter,
  DeepgramDiarizationError,
  type DeepgramConfig,
} from '../adapters/DeepgramNova2Adapter';
import type { WordDiarization } from '../ports/DiarizationProviderPort';

describe('DeepgramNova2Adapter (Phase 2 Sensor Fusion)', () => {
  const config: DeepgramConfig = {
    apiKey: 'test-deepgram-key',
    baseUrl: 'https://api.deepgram.com/v1/listen',
    timeoutMs: 500,
  };

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Mathematical Reduction Logic (calculateMetrics)', () => {
    it('returns zeroes for empty word array', () => {
      const metrics = DeepgramNova2Adapter.calculateMetrics([]);
      expect(metrics).toEqual({
        speakerCount: 0,
        turnEntropy: 0,
        overlapRatio: 0,
      });
    });

    it('calculates 0 entropy for single speaker monologue', () => {
      const words: WordDiarization[] = [
        { word: 'Hello', start: 0, end: 1.0, confidence: 0.99, speaker: 0 },
        { word: 'world', start: 1.2, end: 2.0, confidence: 0.98, speaker: 0 },
        { word: 'today', start: 2.1, end: 3.0, confidence: 0.95, speaker: 0 },
      ];

      const metrics = DeepgramNova2Adapter.calculateMetrics(words);
      expect(metrics.speakerCount).toBe(1);
      expect(metrics.turnEntropy).toBe(0);
      expect(metrics.overlapRatio).toBe(0);
    });

    it('calculates 1.0 bit entropy for perfectly balanced 2-speaker dialogue', () => {
      // Speaker 0 speaks 2.0s, Speaker 1 speaks 2.0s -> p0 = 0.5, p1 = 0.5 -> H = - (0.5*-1 + 0.5*-1) = 1.0
      const words: WordDiarization[] = [
        { word: 'Hi', start: 0, end: 2.0, confidence: 0.99, speaker: 0 },
        { word: 'There', start: 2.0, end: 4.0, confidence: 0.98, speaker: 1 },
      ];

      const metrics = DeepgramNova2Adapter.calculateMetrics(words);
      expect(metrics.speakerCount).toBe(2);
      expect(metrics.turnEntropy).toBe(1.0);
      expect(metrics.overlapRatio).toBe(0);
    });

    it('calculates accurate overlapRatio for simultaneous cross-talk', () => {
      // Speaker 0 speaks [0, 4.0] (4s)
      // Speaker 1 speaks [2.0, 4.0] (2s overlap)
      // Total speech duration = 4s + 2s = 6s
      // Overlap = 2s
      // Overlap ratio = 2 / 6 = 0.3333
      const words: WordDiarization[] = [
        { word: 'Speaker0-part1', start: 0, end: 2.0, confidence: 0.9, speaker: 0 },
        { word: 'Speaker0-part2', start: 2.0, end: 4.0, confidence: 0.9, speaker: 0 },
        { word: 'Speaker1-overlap', start: 2.0, end: 4.0, confidence: 0.9, speaker: 1 },
      ];

      const metrics = DeepgramNova2Adapter.calculateMetrics(words);
      expect(metrics.speakerCount).toBe(2);
      expect(metrics.overlapRatio).toBe(0.3333);
    });

    it('does not count consecutive words from same speaker as overlap', () => {
      // Adjacent/overlapping words from the SAME speaker must not count as cross-talk
      const words: WordDiarization[] = [
        { word: 'Word1', start: 0, end: 1.5, confidence: 0.9, speaker: 0 },
        { word: 'Word2', start: 1.0, end: 2.5, confidence: 0.9, speaker: 0 },
      ];

      const metrics = DeepgramNova2Adapter.calculateMetrics(words);
      expect(metrics.speakerCount).toBe(1);
      expect(metrics.overlapRatio).toBe(0);
    });
  });

  describe('API Fetch & Fail-Closed Guard', () => {
    it('throws error when apiKey is empty', () => {
      expect(() => new DeepgramNova2Adapter({ apiKey: '' })).toThrow(/API key is required/);
    });

    it('successfully parses Deepgram response and computes metrics', async () => {
      const mockResponse = {
        results: {
          channels: [
            {
              alternatives: [
                {
                  words: [
                    { word: 'Welcome', start: 0, end: 1.0, confidence: 0.98, speaker: 0 },
                    { word: 'Thanks', start: 1.0, end: 2.0, confidence: 0.97, speaker: 1 },
                  ],
                },
              ],
            },
          ],
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const adapter = new DeepgramNova2Adapter(config);
      const result = await adapter.diarizeAudioUrl('https://example.com/audio.mp3', 'vid-123');

      expect(result.videoId).toBe('vid-123');
      expect(result.metrics.speakerCount).toBe(2);
      expect(result.metrics.turnEntropy).toBe(1.0);
      expect(result.words).toHaveLength(2);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('fails closed with DeepgramDiarizationError on HTTP 500 error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Deepgram internal crash'),
      } as Response);

      const adapter = new DeepgramNova2Adapter(config);
      await expect(adapter.diarizeAudioUrl('https://example.com/audio.mp3', 'vid-123')).rejects.toThrow(
        DeepgramDiarizationError,
      );
    });

    it('fails closed with timeout error when request hangs past timeoutMs', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((resolvePromise, rejectPromise) => {
          options?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            rejectPromise(err);
          });
        });
      });

      const adapter = new DeepgramNova2Adapter({ ...config, timeoutMs: 50 });
      await expect(adapter.diarizeAudioUrl('https://example.com/audio.mp3', 'vid-123')).rejects.toThrow(
        /timed out after 50ms \(fail-closed\)/,
      );
    });
  });
});
