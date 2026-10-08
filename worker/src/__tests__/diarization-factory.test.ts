import { describe, it, expect, vi } from 'vitest';
import {
  DiarizationFactory,
  DiarizationCascadeExhaustedError,
} from '../services/sensor-fusion/probes/DiarizationFactory';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn() }));
import type {
  DiarizationProviderPort,
  DiarizationResult,
} from '../ports/DiarizationProviderPort';

describe('DiarizationFactory (Cascade Runner)', () => {
  const dummyResult: DiarizationResult = {
    videoId: 'test_vid',
    metrics: {
      speakerCount: 2,
      turnEntropy: 0.95,
      overlapRatio: 0.1,
    },
    latencyMs: 120,
  };

  it('successfully returns primary provider result when AssemblyAI succeeds', async () => {
    const mockAssemblyAI: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockResolvedValue(dummyResult),
    };
    const mockDeepgram: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockRejectedValue(new Error('Should not be called')),
    };

    const factory = new DiarizationFactory({
      cascadeOrder: ['assemblyai', 'deepgram'],
      customProviders: {
        assemblyai: mockAssemblyAI,
        deepgram: mockDeepgram,
      },
    });

    const result = await factory.diarizeAudioUrl('https://example.com/audio.mp3', 'test_vid');

    expect(result).toEqual(dummyResult);
    expect(mockAssemblyAI.diarizeAudioUrl).toHaveBeenCalledTimes(1);
    expect(mockDeepgram.diarizeAudioUrl).not.toHaveBeenCalled();
  });

  it('seamlessly falls back to Deepgram when AssemblyAI fails', async () => {
    const deepgramFallbackResult: DiarizationResult = {
      videoId: 'test_vid',
      metrics: {
        speakerCount: 3,
        turnEntropy: 1.2,
        overlapRatio: 0.15,
      },
      latencyMs: 340,
    };

    const mockAssemblyAI: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockRejectedValue(new Error('AssemblyAI 503 Overloaded')),
    };
    const mockDeepgram: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockResolvedValue(deepgramFallbackResult),
    };

    const factory = new DiarizationFactory({
      cascadeOrder: ['assemblyai', 'deepgram'],
      customProviders: {
        assemblyai: mockAssemblyAI,
        deepgram: mockDeepgram,
      },
    });

    const result = await factory.diarizeAudioUrl('https://example.com/audio.mp3', 'test_vid');

    expect(result).toEqual(deepgramFallbackResult);
    expect(mockAssemblyAI.diarizeAudioUrl).toHaveBeenCalledTimes(1);
    expect(mockDeepgram.diarizeAudioUrl).toHaveBeenCalledTimes(1);
  });

  it('throws DiarizationCascadeExhaustedError when all providers fail', async () => {
    const mockAssemblyAI: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockRejectedValue(new Error('AssemblyAI timeout')),
    };
    const mockDeepgram: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockRejectedValue(new Error('Deepgram 500 error')),
    };

    const factory = new DiarizationFactory({
      cascadeOrder: ['assemblyai', 'deepgram'],
      customProviders: {
        assemblyai: mockAssemblyAI,
        deepgram: mockDeepgram,
      },
    });

    await expect(
      factory.diarizeAudioUrl('https://example.com/audio.mp3', 'test_vid'),
    ).rejects.toThrow(DiarizationCascadeExhaustedError);

    expect(mockAssemblyAI.diarizeAudioUrl).toHaveBeenCalledTimes(1);
    expect(mockDeepgram.diarizeAudioUrl).toHaveBeenCalledTimes(1);
  });

  it('aborts and throws DiarizationCascadeExhaustedError when cascade timeout budget is exhausted', async () => {
    // Provider 1 takes 500ms
    const mockAssemblyAI: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        throw new Error('AssemblyAI failed after 80ms');
      }),
    };
    const mockDeepgram: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockResolvedValue(dummyResult),
    };

    // Set totalCascadeTimeoutMs to 50ms so by the time AssemblyAI fails, budget is already expired
    const factory = new DiarizationFactory({
      cascadeOrder: ['assemblyai', 'deepgram'],
      totalCascadeTimeoutMs: 50,
      customProviders: {
        assemblyai: mockAssemblyAI,
        deepgram: mockDeepgram,
      },
    });

    await expect(
      factory.diarizeAudioUrl('https://example.com/audio.mp3', 'test_timeout_vid'),
    ).rejects.toThrow(DiarizationCascadeExhaustedError);

    expect(mockAssemblyAI.diarizeAudioUrl).toHaveBeenCalledTimes(1);
    // Deepgram must NOT have been called because budget was already exhausted
    expect(mockDeepgram.diarizeAudioUrl).not.toHaveBeenCalled();
  });

  it('does not mutate the caller-provided cascadeOrder array', () => {
    const cascadeOrder = ['assemblyai', 'deepgram'] as const;
    const factory = new DiarizationFactory({
      cascadeOrder: [...cascadeOrder],
      customProviders: { assemblyai: { diarizeAudioUrl: vi.fn() } },
    });

    expect(factory.getCascadeOrder()).toEqual(['assemblyai', 'deepgram']);
  });

  it('sanitizes provider error text (URLs redacted) before Sentry capture and console logging', async () => {
    const signedError = new Error(
      'AssemblyAI submission HTTP 400: invalid url https://r2.example.com/audio.mp3?sig=SECRET_TOKEN',
    );
    const { captureException: sentryCapture } = await import('@sentry/cloudflare');
    vi.mocked(sentryCapture).mockClear();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const factory = new DiarizationFactory({
        cascadeOrder: ['assemblyai', 'deepgram'],
        customProviders: {
          assemblyai: { diarizeAudioUrl: vi.fn().mockRejectedValue(signedError) },
          deepgram: { diarizeAudioUrl: vi.fn().mockRejectedValue(new Error('deepgram down')) },
        },
      });

      await expect(
        factory.diarizeAudioUrl('https://example.com/audio.mp3?token=SUPERSECRET', 'vid_redact'),
      ).rejects.toThrow(DiarizationCascadeExhaustedError);

      const capturedFirst = (sentryCapture as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Error | undefined;
      expect(capturedFirst).toBeInstanceOf(Error);
      expect(capturedFirst?.message).not.toContain('SECRET_TOKEN');
      expect(capturedFirst?.message).toContain('[redacted-url]');
      const logged = consoleError.mock.calls.map((c) => String(c[1] ?? c[0])).join(' ');
      expect(logged).not.toContain('SECRET_TOKEN');
    } finally {
      consoleError.mockRestore();
    }
  });
});
