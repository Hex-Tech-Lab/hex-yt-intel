/**
 * EpistemicPipelineDispatcher — Domain Service (Hexagonal-Lite)
 *
 * Glues Layer 0 (Sensor Fusion & S1-S6 Matrix Router) to Layer 2
 * of the Epistemic Schism (Part A Grounded Extraction + Part B Projective Synthesis).
 *
 * Responsibilities:
 * 1. Ingests videoId, raw transcript, durationSeconds, audioUrl or audioBuffer/videoSampleBuffers.
 * 2. Layer 0: Executes SensorRegistry (DiarizationFactory cascade & MultimodalProbeRunner)
 *    and evaluates routeFusion() -> S1-S6 classification and confidence.
 * 3. Layer 2 Part A: Dispatches GroundedExtractionEngine.extractGroundedClaims() over transcript chunks.
 * 4. Ghost Row Persistence: Flushes GroundedExtractionPayload non-blockingly via atomic persistence
 *    primitive with status 'partial_extraction'.
 * 5. Layer 2 Part B: Dispatches ProjectiveSynthesisEngine.synthesizeProjections() exclusively
 *    over Part A's validated JSON payload (raw transcript is strictly excluded).
 * 6. Returns a unified EpistemicAnalysisResult.
 */

import * as Sentry from '@sentry/cloudflare';
import {
  GroundedExtractionEngine,
  type GroundedExtractionInput,
} from './GroundedExtractionEngine';
import {
  ProjectiveSynthesisEngine,
  type ProjectiveSynthesisPayload,
} from './ProjectiveSynthesisEngine';
import {
  SensorRegistry,
  type SensorRegistryConfig,
  type FusionAnalysisRequest,
} from './sensor-fusion/SensorRegistry';
import {
  routeFusion,
  type FusionResult,
  type FusionRoute,
  type FusionInput,
} from './sensor-fusion/matrix/fusion-router';
import { countTurnMarkers } from './sensor-fusion/heuristics/jev-text-parser';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { LLMCascadePort } from '../ports/LLMCascadePort';
import type { GroundedExtractionPayload } from '../types/grounded-extraction';

export interface EpistemicPipelineInput {
  analysisId: string;
  videoId: string;
  title?: string;
  transcript: string;
  durationSeconds: number;
  audioUrl?: string;
  audioBuffer?: Buffer;
  videoSampleBuffers?: Buffer[];
  chunkUrls?: Array<{ chunkIndex: number; startTimeSeconds: number; mediaUrl: string }>;
  persona?: string;
  /**
   * Optional custom persistence hook for the partial ghost row.
   * If omitted, a non-blocking no-op or default atomic persistence is used.
   */
  persistGhostRow?: (payload: GroundedExtractionPayload) => Promise<boolean>;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export interface EpistemicAnalysisResult {
  videoId: string;
  analysisId: string;
  classification: {
    route: FusionRoute;
    confidence: number;
    speakerCount: number;
    degradedSensors?: boolean;
  };
  groundedExtraction: GroundedExtractionPayload;
  projectiveSynthesis: ProjectiveSynthesisPayload;
  latencyMs: number;
}

export interface EpistemicPipelineDispatcherConfig {
  promptBuilder: PromptBuilderPort;
  cascade: LLMCascadePort;
  sensorConfig?: SensorRegistryConfig;
}

export class EpistemicPipelineDispatcher {
  private readonly promptBuilder: PromptBuilderPort;
  private readonly cascade: LLMCascadePort;
  private readonly sensorRegistry: SensorRegistry;
  private readonly groundedEngine: GroundedExtractionEngine;
  private readonly projectiveEngine: ProjectiveSynthesisEngine;

  constructor(config: EpistemicPipelineDispatcherConfig) {
    this.promptBuilder = config.promptBuilder;
    this.cascade = config.cascade;
    this.sensorRegistry = new SensorRegistry(config.sensorConfig ?? {});
    this.groundedEngine = new GroundedExtractionEngine(this.promptBuilder, this.cascade);
    this.projectiveEngine = new ProjectiveSynthesisEngine(this.promptBuilder, this.cascade);
  }

  /**
   * Executes the full two-pass Epistemic pipeline stitched with Sensor Fusion.
   */
  async dispatchAnalysis(input: EpistemicPipelineInput): Promise<EpistemicAnalysisResult> {
    const startTime = Date.now();

    // 1. Layer 0: Sensor Fusion & Deterministic Matrix Routing
    const turnMarkerCount = countTurnMarkers(input.transcript);

    let diarizationSpeakerCount = 1;
    let uiFramesDetected = false;
    let debateProsodyDetected = false;
    let degradedSensors = false;

    if (this.sensorRegistry.getDiarizationProvider() || this.sensorRegistry.getMultimodalProvider()) {
      try {
        const fusionRequest: FusionAnalysisRequest = {
          videoId: input.videoId,
          audioUrl: input.audioUrl,
          chunkUrls: input.chunkUrls,
          turnMarkerCount,
          directAddressIntensity: 0,
          proceduralInstructionIntensity: 0,
          tangentialFluffIntensity: 0,
        };

        const fusionResponse = await this.sensorRegistry.fuseSensors(fusionRequest);
        if (fusionResponse.diarization?.metrics.speakerCount) {
          diarizationSpeakerCount = fusionResponse.diarization.metrics.speakerCount;
        }
        if (fusionResponse.multimodal?.summary) {
          uiFramesDetected = fusionResponse.multimodal.summary.uiFramesDetected;
          debateProsodyDetected = fusionResponse.multimodal.summary.debateProsodyDetected;
        }
      } catch (sensorErr: unknown) {
        degradedSensors = true;
        console.error('[EpistemicPipelineDispatcher] Sensor execution encountered non-fatal error:', sensorErr);
        Sentry.captureException(sensorErr, {
          tags: { component: 'EpistemicPipelineDispatcher', stage: 'layer0-sensors', videoId: input.videoId },
        });
      } finally {
        // Priority 1 Memory Guard: Explicitly dereference and delete ephemeral audio/video buffers.
        // Cloudflare Workers enforce a strict 128MB RAM ceiling. Retaining raw audio/video buffers
        // across the downstream 30-45s LLM generation phases risks OOM worker crashes.
        // Dereferencing here ensures V8 can reclaim this heap allocation immediately.
        delete (input as { audioBuffer?: unknown }).audioBuffer;
        delete (input as { videoSampleBuffers?: unknown }).videoSampleBuffers;
      }
    }

    const fusionInput: FusionInput = {
      turnMarkerCount,
      diarizationSpeakerCount,
      uiFramesDetected,
      debateProsodyDetected,
      directAddressIntensity: 0,
      proceduralInstructionIntensity: 0,
      tangentialFluffIntensity: 0,
      degradedSensors,
    };

    const fusionResult: FusionResult = routeFusion(fusionInput);

    // 2. Prepare chunks for Part A Grounded Extraction
    // Break transcript into rough phrase chunks preserving temporal bounds
    const transcriptChunks = EpistemicPipelineDispatcher.buildSimpleChunks(
      input.transcript,
      input.durationSeconds,
    );

    // 3. Layer 2 Part A: Grounded Extraction Pass
    const extractionInput: GroundedExtractionInput = {
      analysisId: input.analysisId,
      videoId: input.videoId,
      transcriptChunks,
      metadata: {
        title: input.title,
        speakerCount: diarizationSpeakerCount,
        durationSeconds: input.durationSeconds,
        classification: fusionResult.route,
      },
      flushPartialGhostRow: (payload: GroundedExtractionPayload) => {
        if (input.persistGhostRow) {
          return input.persistGhostRow(payload);
        }
        return Promise.resolve(true);
      },
      waitUntil: input.waitUntil,
    };

    const groundedPayload = await this.groundedEngine.extractGroundedClaims(extractionInput);

    // 4. Layer 2 Part B: Projective Synthesis Pass
    // The raw transcript is strictly excluded from input
    const projectivePayload = await this.projectiveEngine.synthesizeProjections({
      analysisId: input.analysisId,
      videoId: input.videoId,
      groundedPayload,
      persona: input.persona,
    });

    const latencyMs = Date.now() - startTime;

    return {
      videoId: input.videoId,
      analysisId: input.analysisId,
      classification: {
        route: fusionResult.route,
        confidence: fusionResult.confidence,
        speakerCount: diarizationSpeakerCount,
        degradedSensors: fusionResult.degradedSensors,
      },
      groundedExtraction: groundedPayload,
      projectiveSynthesis: projectivePayload,
      latencyMs,
    };
  }

  /**
   * Helper to partition flat transcript into timestamped chunks.
   */
  public static buildSimpleChunks(
    transcript: string,
    durationSeconds: number,
    chunkDurationSec: number = 60,
  ): Array<{ text: string; start: number; end: number; speaker?: string }> {
    const clean = transcript.trim();
    if (!clean) return [];

    const effectiveDuration = durationSeconds > 0 ? durationSeconds : 60;
    const numChunks = Math.max(1, Math.ceil(effectiveDuration / chunkDurationSec));
    const words = clean.split(/\s+/);
    const wordsPerChunk = Math.max(1, Math.ceil(words.length / numChunks));
    const chunks: Array<{ text: string; start: number; end: number; speaker?: string }> = [];

    for (let i = 0; i < numChunks; i++) {
      const startWord = i * wordsPerChunk;
      const endWord = Math.min(words.length, (i + 1) * wordsPerChunk);
      const chunkWords = words.slice(startWord, endWord);
      if (chunkWords.length === 0) continue;
      const chunkText = chunkWords.join(' ').trim();
      if (!chunkText) continue;

      const start = Math.round(((i * chunkDurationSec) / effectiveDuration) * effectiveDuration);
      const end = Math.min(
        effectiveDuration,
        Math.round((((i + 1) * chunkDurationSec) / effectiveDuration) * effectiveDuration),
      );

      chunks.push({
        text: chunkText,
        start,
        end,
      });
    }

    return chunks;
  }
}
