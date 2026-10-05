/**
 * SensorRegistry — Domain Service & Factory (Hexagonal-Lite)
 *
 * Wires physical acoustic diarization (DeepgramNova2Adapter) and multimodal
 * visual/prosody probes (MultimodalProbeRunner) into the S1-S6 Sensor Fusion Matrix
 * (ADR 039 §1.1-§1.3).
 *
 * Provides fallback mock capabilities for isolated unit testing, and exposes
 * fuseSensors() to directly feed the deterministic matrix router.
 */

import { DeepgramNova2Adapter } from '../../adapters/DeepgramNova2Adapter';
import { MultimodalProbeRunner } from './probes/MultimodalProbeRunner';
import { routeFusion, type FusionInput, type FusionResult } from './matrix/fusion-router';
import type { DiarizationProviderPort, DiarizationResult } from '../../ports/DiarizationProviderPort';
import type { MultimodalProbePort, MultimodalProbeResult } from '../../ports/MultimodalProbePort';

export interface SensorRegistryConfig {
  deepgramApiKey?: string;
  openrouterApiKey?: string;
  deepgramTimeoutMs?: number;
  multimodalTimeoutMs?: number;
  mockDiarization?: DiarizationProviderPort;
  mockMultimodal?: MultimodalProbePort;
}

export interface FusionAnalysisRequest {
  videoId: string;
  audioUrl?: string;
  chunkUrls?: Array<{ chunkIndex: number; startTimeSeconds: number; mediaUrl: string }>;
  turnMarkerCount: number;
  directAddressIntensity: number;
  proceduralInstructionIntensity: number;
  tangentialFluffIntensity: number;
}

export interface FusionAnalysisResponse {
  videoId: string;
  fusionResult: FusionResult;
  diarization: DiarizationResult | null;
  multimodal: MultimodalProbeResult | null;
}

export class SensorRegistry {
  private readonly diarizationProvider: DiarizationProviderPort | null = null;
  private readonly multimodalProvider: MultimodalProbePort | null = null;

  constructor(config: SensorRegistryConfig) {
    if (config.mockDiarization) {
      this.diarizationProvider = config.mockDiarization;
    } else if (config.deepgramApiKey && config.deepgramApiKey.trim() !== '') {
      this.diarizationProvider = new DeepgramNova2Adapter({
        apiKey: config.deepgramApiKey,
        timeoutMs: config.deepgramTimeoutMs,
      });
    }

    if (config.mockMultimodal) {
      this.multimodalProvider = config.mockMultimodal;
    } else if (config.openrouterApiKey && config.openrouterApiKey.trim() !== '') {
      this.multimodalProvider = new MultimodalProbeRunner({
        apiKey: config.openrouterApiKey,
        timeoutMs: config.multimodalTimeoutMs,
      });
    }
  }

  getDiarizationProvider(): DiarizationProviderPort | null {
    return this.diarizationProvider;
  }

  getMultimodalProvider(): MultimodalProbePort | null {
    return this.multimodalProvider;
  }

  /**
   * Executes sensor fusion over acoustic and visual signals, then routes through
   * the deterministic S1-S6 matrix.
   */
  async fuseSensors(request: FusionAnalysisRequest): Promise<FusionAnalysisResponse> {
    const diarizationPromise =
      this.diarizationProvider && request.audioUrl
        ? this.diarizationProvider.diarizeAudioUrl(request.audioUrl, request.videoId)
        : Promise.resolve(null);

    const multimodalPromise =
      this.multimodalProvider && request.chunkUrls && request.chunkUrls.length > 0
        ? this.multimodalProvider.inspectVideoChunks(request.videoId, request.chunkUrls)
        : Promise.resolve(null);

    const [diarization, multimodal] = await Promise.all([diarizationPromise, multimodalPromise]);

    const fusionInput: FusionInput = {
      turnMarkerCount: request.turnMarkerCount,
      diarizationSpeakerCount: diarization?.metrics.speakerCount ?? 1,
      uiFramesDetected: multimodal?.summary.uiFramesDetected ?? false,
      debateProsodyDetected: multimodal?.summary.debateProsodyDetected ?? false,
      directAddressIntensity: request.directAddressIntensity,
      proceduralInstructionIntensity: request.proceduralInstructionIntensity,
      tangentialFluffIntensity: request.tangentialFluffIntensity,
    };

    const fusionResult = routeFusion(fusionInput);

    return {
      videoId: request.videoId,
      fusionResult,
      diarization,
      multimodal,
    };
  }
}
