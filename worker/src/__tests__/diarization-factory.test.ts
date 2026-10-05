import { describe, it, expect, vi } from 'vitest';
import {
  DiarizationFactory,
  DiarizationCascadeExhaustedError,
} from '../services/sensor-fusion/probes/DiarizationFactory';
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
});
