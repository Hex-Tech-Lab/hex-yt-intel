import { describe, it, expect, vi } from 'vitest';
import { SensorRegistry } from '../services/sensor-fusion/SensorRegistry';
import type { DiarizationProviderPort } from '../ports/DiarizationProviderPort';
import type { MultimodalProbePort } from '../ports/MultimodalProbePort';

describe('SensorRegistry (Phase 2 Sensor Fusion)', () => {
  it('wires mock providers and correctly routes S1 monologue through the matrix', async () => {
    const mockDiarization: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockResolvedValue({
        videoId: 'vid-s1',
        metrics: { speakerCount: 1, turnEntropy: 0, overlapRatio: 0 },
        latencyMs: 120,
      }),
    };

    const mockMultimodal: MultimodalProbePort = {
      inspectVideoChunks: vi.fn().mockResolvedValue({
        videoId: 'vid-s1',
        chunks: [],
        summary: {
          uiFramesDetected: false,
          debateProsodyDetected: false,
          maxVisibleSpeakers: 1,
          meanConfidence: 0.95,
        },
        latencyMs: 200,
      }),
    };

    const registry = new SensorRegistry({
      mockDiarization,
      mockMultimodal,
    });

    const response = await registry.fuseSensors({
      videoId: 'vid-s1',
      audioUrl: 'https://r2.hex-yt-intel/audio.mp3',
      chunkUrls: [{ chunkIndex: 0, startTimeSeconds: 60, mediaUrl: 'https://r2.hex-yt-intel/c0.mp4' }],
      turnMarkerCount: 45, // Typographic artifacts that would fool text-only classifiers
      directAddressIntensity: 0,
      proceduralInstructionIntensity: 0,
      tangentialFluffIntensity: 0,
    });

    // Acoustic reality (speakerCount: 1) overrides 45 caption markers -> S1 Monologue
    expect(response.fusionResult.route).toBe('S1');
    expect(response.fusionResult.confidence).toBe(0.85);
    expect(response.diarization?.metrics.speakerCount).toBe(1);
    expect(response.multimodal?.summary.uiFramesDetected).toBe(false);
  });

  it('correctly routes S4 procedural tutorial when UI frames are detected (>40%)', async () => {
    const mockDiarization: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockResolvedValue({
        videoId: 'vid-s4',
        metrics: { speakerCount: 1, turnEntropy: 0, overlapRatio: 0 },
        latencyMs: 100,
      }),
    };

    const mockMultimodal: MultimodalProbePort = {
      inspectVideoChunks: vi.fn().mockResolvedValue({
        videoId: 'vid-s4',
        chunks: [],
        summary: {
          uiFramesDetected: true,
          debateProsodyDetected: false,
          maxVisibleSpeakers: 1,
          meanConfidence: 0.98,
        },
        latencyMs: 250,
      }),
    };

    const registry = new SensorRegistry({
      mockDiarization,
      mockMultimodal,
    });

    const response = await registry.fuseSensors({
      videoId: 'vid-s4',
      audioUrl: 'https://r2.hex-yt-intel/audio.mp3',
      chunkUrls: [{ chunkIndex: 0, startTimeSeconds: 60, mediaUrl: 'https://r2.hex-yt-intel/c0.mp4' }],
      turnMarkerCount: 0,
      directAddressIntensity: 0,
      proceduralInstructionIntensity: 3,
      tangentialFluffIntensity: 0,
    });

    // Hard override rule: uiFramesDetected -> S4 Procedural/Code tutorial
    expect(response.fusionResult.route).toBe('S4');
    expect(response.fusionResult.confidence).toBe(0.95);
  });
});
