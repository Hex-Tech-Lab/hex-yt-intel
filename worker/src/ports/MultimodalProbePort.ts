/**
 * MultimodalProbePort — Domain Port (Hexagonal-Lite)
 *
 * Contract for visual and prosody inspection over ephemeral video chunks
 * (ADR 039). Evaluates whether code editors, slides, or UI occupy >40%
 * of the visual frame, and detects rapid conversational cross-talk / contention.
 */

export interface MultimodalChunkInspection {
  chunkIndex: number;
  startTimeSeconds: number;
  uiFramesDetected: boolean;
  debateProsodyDetected: boolean;
  visibleSpeakerCount: 0 | 1 | 2 | 3;
  confidence: number;
}

export interface MultimodalProbeResult {
  videoId: string;
  chunks: MultimodalChunkInspection[];
  /** Overall video-level synthesis flags for the S1-S6 matrix router. */
  summary: {
    uiFramesDetected: boolean;
    debateProsodyDetected: boolean;
    maxVisibleSpeakers: number;
    meanConfidence: number;
  };
  latencyMs: number;
}

export interface MultimodalProbePort {
  /**
   * Inspects a set of sampled timestamp intervals for a video.
   * Implementation sends sampled video clips/frames to a multimodal vision LLM
   * (e.g. Gemini 2.5 Flash or Qwen2.5-Omni via OpenRouter).
   *
   * Must FAIL CLOSED on timeout or model parsing error.
   */
  inspectVideoChunks(
    videoId: string,
    chunkUrls: Array<{ chunkIndex: number; startTimeSeconds: number; mediaUrl: string }>,
  ): Promise<MultimodalProbeResult>;
}
