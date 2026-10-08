/**
 * DiarizationProviderPort — Domain Port (Hexagonal-Lite)
 *
 * Contract for physical acoustic diarization (ADR 039 §1.1 / §5.2).
 * Operates on audio streams or pre-recorded audio URLs to compute physical
 * acoustic reality decoupled from typographic transcript markers (>>).
 */

export interface WordDiarization {
  word: string;
  /** Interval start in seconds (float). */
  start: number;
  /** Interval end in seconds (float). */
  end: number;
  confidence: number;
  /** Zero-based numeric speaker index (normalized from provider labels). */
  speaker: number;
}

export interface DiarizationMetrics {
  /** Total number of unique physical speakers detected. */
  speakerCount: number;
  /**
   * Shannon entropy of speaker speaking-time distribution (in bits):
   * H = - \sum (p_i * log2(p_i)) where p_i is speaker i's proportion of total speech duration.
   * Higher entropy indicates more evenly distributed dialogue/debate;
   * 0 indicates a strict monologue.
   */
  turnEntropy: number;
  /**
   * Ratio of simultaneous speech / cross-talk duration to total speech duration:
   * overlapDuration / totalSpeechDuration in [0, 1].
   */
  overlapRatio: number;
}

export interface DiarizationResult {
  videoId: string;
  metrics: DiarizationMetrics;
  words?: WordDiarization[];
  /** Execution latency in milliseconds. */
  latencyMs: number;
}

export interface DiarizeAudioOptions {
  timeoutMs?: number;
}

export interface DiarizationProviderPort {
  /**
   * Ingests an audio source URL (e.g. presigned S3/R2 URL or direct media link)
   * and computes physical diarization metrics.
   *
   * Must FAIL CLOSED on timeout or API unavailability.
   */
  diarizeAudioUrl(audioUrl: string, videoId: string, options?: DiarizeAudioOptions): Promise<DiarizationResult>;
}
