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
  /** JEV intensity scores, integers 0-3. Optional; defaults to 0 when omitted. */
  directAddressIntensity?: number;
  proceduralInstructionIntensity?: number;
  tangentialFluffIntensity?: number;
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

/** Orchestrates sensor fusion, grounded extraction, and projective synthesis for one analysis (see module docblock). */
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

    let diarizationSpeakerCount = 0;
    let uiFramesDetected = false;
    let debateProsodyDetected = false;
    let degradedSensors = false;

    // Buffer-only inputs have no media URL for either sensor to consume: without a
    // provider that accepts raw buffers, physical sensing is impossible and the
    // pipeline must report degraded sensors rather than silently heuristic routing.
    const hasUnroutableBuffers = Boolean(input.audioBuffer || input.videoSampleBuffers?.length);

    let fusionResponse: Awaited<ReturnType<SensorRegistry['fuseSensors']>> | null = null;

    try {
      const fusionRequest: FusionAnalysisRequest = {
        videoId: input.videoId,
        audioUrl: input.audioUrl,
        chunkUrls: input.chunkUrls,
        turnMarkerCount,
        directAddressIntensity: input.directAddressIntensity ?? 0,
        proceduralInstructionIntensity: input.proceduralInstructionIntensity ?? 0,
        tangentialFluffIntensity: input.tangentialFluffIntensity ?? 0,
      };

      fusionResponse = await this.sensorRegistry.fuseSensors(fusionRequest);
      if (fusionResponse.diarization?.metrics.speakerCount !== undefined) {
        diarizationSpeakerCount = fusionResponse.diarization.metrics.speakerCount;
      }
      if (fusionResponse.multimodal?.summary) {
        uiFramesDetected = fusionResponse.multimodal.summary.uiFramesDetected;
        debateProsodyDetected = fusionResponse.multimodal.summary.debateProsodyDetected;
      }
      if (fusionResponse.fusionResult.degradedSensors) {
        degradedSensors = true;
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
      // Runs unconditionally: buffers must be dropped even when no sensor provider is
      // configured (otherwise they are retained across the 30-45s LLM phases).
      delete (input as { audioBuffer?: unknown }).audioBuffer;
      delete (input as { videoSampleBuffers?: unknown }).videoSampleBuffers;
    }

    // Buffer-only inputs have no media URL for either sensor to consume: without a
    // provider that accepts raw buffers, physical sensing is impossible and the
    // pipeline must report degraded sensors rather than silently heuristic routing.
    if (hasUnroutableBuffers) {
      degradedSensors = true;
    }

    const fusionInput: FusionInput = {
      turnMarkerCount,
      diarizationSpeakerCount,
      uiFramesDetected,
      debateProsodyDetected,
      directAddressIntensity: input.directAddressIntensity ?? 0,
      proceduralInstructionIntensity: input.proceduralInstructionIntensity ?? 0,
      tangentialFluffIntensity: input.tangentialFluffIntensity ?? 0,
      degradedSensors,
    };

    // fuseSensors() already computed the S1-S6 route from the same sensor signals
    // (SensorRegistry.fuseSensors calls routeFusion internally); reuse it instead of
    // recomputing. When no sensor ran (no providers configured) OR buffer-only media
    // makes physical sensing unroutable (a flag fuseSensors cannot see), fall back to
    // a local routeFusion so degradedSensors is honored in the route confidence.
    const fusionResult: FusionResult =
      fusionResponse && !hasUnroutableBuffers
        ? fusionResponse.fusionResult
        : routeFusion(fusionInput);

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
        // No persistence hook supplied: report failure rather than a fabricated
        // success so the partial ghost row is never silently dropped.
        console.warn(
          '[EpistemicPipelineDispatcher] No persistGhostRow configured; partial ghost row not persisted',
          { analysisId: input.analysisId, videoId: input.videoId },
        );
        return Promise.resolve(false);
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

    const effectiveChunkDurationSec = chunkDurationSec > 0 ? chunkDurationSec : 60;
    const effectiveDuration = durationSeconds > 0 ? durationSeconds : 60;
    const numChunks = Math.max(1, Math.ceil(effectiveDuration / effectiveChunkDurationSec));
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

      // Timestamps advance linearly by one chunk duration per chunk, clamped to
      // the effective duration.
      const start = Math.min(i * effectiveChunkDurationSec, effectiveDuration);
      const end = Math.min((i + 1) * effectiveChunkDurationSec, effectiveDuration);

      chunks.push({
        text: chunkText,
        start,
        end,
      });
    }

    return chunks;
  }
}
