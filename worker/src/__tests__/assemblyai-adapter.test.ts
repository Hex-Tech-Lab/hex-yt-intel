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

    it('counts each speaker once per wall-clock instant (3 speakers overlapped = 1/3, not 1)', () => {
      const words: WordDiarization[] = [
        { word: 'a', start: 0, end: 1, confidence: 0.9, speaker: 0 },
        { word: 'b', start: 0, end: 1, confidence: 0.9, speaker: 1 },
        { word: 'c', start: 0, end: 1, confidence: 0.9, speaker: 2 },
      ];

      const metrics = AssemblyAIAdapter.calculateMetrics(words);
      // 3s total speech, only 1s of shared wall-clock overlap
      expect(metrics.overlapRatio).toBe(0.3333);
    });

    it('counts overlapping same-speaker words once toward speaking time (entropy)', () => {
      const words: WordDiarization[] = [
        { word: 'one', start: 0, end: 1.5, confidence: 0.9, speaker: 0 },
        { word: 'two', start: 1.0, end: 2.5, confidence: 0.9, speaker: 0 },
        { word: 'resp', start: 0, end: 2.5, confidence: 0.9, speaker: 1 },
      ];

      const metrics = AssemblyAIAdapter.calculateMetrics(words);
      // Speaker 0 wall-clock = 2.5s, speaker 1 = 2.5s -> balanced dialogue = 1.0 bit
      expect(metrics.speakerCount).toBe(2);
      expect(metrics.turnEntropy).toBe(1.0);
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
            json: () => Promise.resolve({
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
            json: () => Promise.resolve({
              id: 'transcript_test_123',
              status: 'processing',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
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
        text: () => Promise.resolve('Cluster overload'),
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
            json: () => Promise.resolve({
              id: 'transcript_err',
              status: 'queued',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
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

    it('includes the configured speech_model in the submission body', async () => {
      const adapter = new AssemblyAIAdapter({ ...config, speechModel: 'best' });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 't1', status: 'completed', words: [] }),
      } as Response);
      globalThis.fetch = fetchMock;

      await adapter.diarizeAudioUrl('https://example.com/audio.mp3', 'vid_model');

      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(body.speech_model).toBe('best');
      expect(body.speaker_labels).toBe(true);
    });

    it('redacts URLs echoed in provider error text', async () => {
      const adapter = new AssemblyAIAdapter(config);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('invalid audio_url https://r2.example.com/a.mp3?sig=SECRET_TOKEN'),
      } as Response);

      await expect(
        adapter.diarizeAudioUrl('https://example.com/audio.mp3', 'vid_redact'),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof Error &&
          !err.message.includes('SECRET_TOKEN') &&
          err.message.includes('[redacted-url]'),
      );
    });
  });
});
