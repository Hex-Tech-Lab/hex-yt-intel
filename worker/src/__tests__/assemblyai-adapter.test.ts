import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AssemblyAIAdapter,
  AssemblyAIDiarizationError,
  type AssemblyAIConfig,
} from '../adapters/AssemblyAIAdapter';
import type { WordDiarization } from '../ports/DiarizationProviderPort';

describe('AssemblyAIAdapter (Phase 2 Sensor Fusion - Diarization Cascade)', () => {
  const config: AssemblyAIConfig = {
    apiKey: 'test-assemblyai-key',
    baseUrl: 'https://api.assemblyai.com/v2/transcript',
    timeoutMs: 1000,
    pollIntervalMs: 50,
  };

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Mathematical Reduction Logic (calculateMetrics)', () => {
    it('returns zeroes for empty word array', () => {
      const metrics = AssemblyAIAdapter.calculateMetrics([]);
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

      const metrics = AssemblyAIAdapter.calculateMetrics(words);
      expect(metrics.speakerCount).toBe(1);
      expect(metrics.turnEntropy).toBe(0);
      expect(metrics.overlapRatio).toBe(0);
    });

    it('calculates 1.0 bit entropy for perfectly balanced 2-speaker dialogue', () => {
      const words: WordDiarization[] = [
        { word: 'Hi', start: 0, end: 2.0, confidence: 0.99, speaker: 0 },
        { word: 'There', start: 2.0, end: 4.0, confidence: 0.98, speaker: 1 },
      ];

      const metrics = AssemblyAIAdapter.calculateMetrics(words);
      expect(metrics.speakerCount).toBe(2);
      expect(metrics.turnEntropy).toBe(1.0);
      expect(metrics.overlapRatio).toBe(0);
    });

    it('calculates accurate overlapRatio for simultaneous speech', () => {
      const words: WordDiarization[] = [
        { word: 'Speaker0', start: 0, end: 4.0, confidence: 0.95, speaker: 0 },
        { word: 'Speaker1', start: 1.0, end: 3.0, confidence: 0.95, speaker: 1 },
      ];

      const metrics = AssemblyAIAdapter.calculateMetrics(words);
      expect(metrics.speakerCount).toBe(2);
      expect(metrics.overlapRatio).toBe(0.3333);
    });
  });

  describe('API Polling & Execution Lifecycle', () => {
    it('successfully submits and polls completed transcript', async () => {
      const adapter = new AssemblyAIAdapter(config);

      let pollCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              id: 'transcript_test_123',
              status: 'queued',
            }),
          } as Response);
        }

        pollCount++;
        if (pollCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              id: 'transcript_test_123',
              status: 'processing',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'transcript_test_123',
            status: 'completed',
            words: [
              { text: 'Hello', start: 0, end: 1000, confidence: 0.99, speaker: 'A' },
              { text: 'World', start: 1000, end: 2000, confidence: 0.98, speaker: 'B' },
            ],
          }),
        } as Response);
      });

      const result = await adapter.diarizeAudioUrl('https://example.com/audio.mp3', 'vid_456');

      expect(result.videoId).toBe('vid_456');
      expect(result.metrics.speakerCount).toBe(2);
      expect(result.metrics.turnEntropy).toBe(1.0);
      expect(result.words?.length).toBe(2);
      expect(result.words?.[0]?.speaker).toBe(0);
      expect(result.words?.[1]?.speaker).toBe(1);
    });

    it('fails closed when AssemblyAI returns 5xx on submission', async () => {
      const adapter = new AssemblyAIAdapter(config);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'Cluster overload',
      } as Response);

      await expect(
        adapter.diarizeAudioUrl('https://example.com/audio.mp3', 'vid_fail'),
      ).rejects.toThrow(AssemblyAIDiarizationError);
    });

    it('fails closed when AssemblyAI transcript poll status returns error', async () => {
      const adapter = new AssemblyAIAdapter(config);

      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              id: 'transcript_err',
              status: 'queued',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'transcript_err',
            status: 'error',
            error: 'Audio file unreadable or corrupt',
          }),
        } as Response);
      });

      await expect(
        adapter.diarizeAudioUrl('https://example.com/audio.mp3', 'vid_fail'),
      ).rejects.toThrow(/Audio file unreadable or corrupt/);
    });
  });
});
