/**
 * PromptGuard — Domain Service for Input Injection Screening (ADR-043 Part B)
 *
 * Implements PromptGuardPort. Segments current-turn user text into 512-token windows with
 * overlap, scans the segments through the Groq client, takes the maximum attack score, and
 * fails open on any classifier error. Domain logic only: the Sentry reporter is injected.
 */

import type {
  PromptGuardPort,
  PromptGuardScreenInput,
  PromptGuardResult,
  PromptGuardMode,
  PromptGuardVerdict,
  PromptGuardSegmentResult,
} from '../ports/PromptGuardPort';
import { GroqPromptGuardTimeoutError, type IGroqPromptGuardClient } from './GroqPromptGuardClient';

export interface PromptGuardServiceConfig {
  mode: PromptGuardMode;
  maxAttackScore: number;
  gatesAccepted: boolean;
  timeoutMs: number;
}

/** Reports a fail-open event (wired to Sentry by the caller). */
export type PromptGuardFailOpenReporter = (error: Error, context: { skipReason: 'timeout' | 'api_error' }) => void;

/**
 * Prompt Guard's tokenizer is not available in the worker. The 512-token window is
 * approximated at 4 characters per token; the overlap is 64 tokens.
 */
const WINDOW_TOKENS = 512;
const OVERLAP_TOKENS = 64;
const CHARS_PER_TOKEN = 4;
const SNIPPET_CHARS = 80;

/** Splits text into overlapping windows. Short text yields exactly one segment. */
export function segmentText(text: string): string[] {
  const windowChars = WINDOW_TOKENS * CHARS_PER_TOKEN;
  const strideChars = (WINDOW_TOKENS - OVERLAP_TOKENS) * CHARS_PER_TOKEN;
  if (text.length <= windowChars) return [text];

  const segments: string[] = [];
  for (let start = 0; ; start += strideChars) {
    const end = start + windowChars;
    segments.push(text.slice(start, end));
    if (end >= text.length) break;
  }
  return segments;
}

export class PromptGuard implements PromptGuardPort {
  private readonly client: IGroqPromptGuardClient;
  private readonly config: PromptGuardServiceConfig;
  private readonly reportFailOpen: PromptGuardFailOpenReporter;

  constructor(
    client: IGroqPromptGuardClient,
    config: PromptGuardServiceConfig,
    reportFailOpen: PromptGuardFailOpenReporter = () => {},
  ) {
    this.client = client;
    this.config = config;
    this.reportFailOpen = reportFailOpen;
  }

  /**
   * Evaluates user input against Prompt Guard.
   * Mode `off` or empty input returns without calling Groq. Mode `block` is refused
   * (treated as `flag`) unless gatesAccepted is true. Any classifier error fails open.
   */
  public async screenInput(input: PromptGuardScreenInput): Promise<PromptGuardResult> {
    if (this.config.mode === 'off' || !input.userText.trim()) {
      return {
        verdict: 'pass',
        maxScore: 0.0,
        scannedSegments: 0,
        model: 'none',
        latencyMs: 0,
        skipped: true,
        skipReason: this.config.mode === 'off' ? 'mode_off' : 'empty_input',
        segments: [],
      };
    }

    const started = Date.now();
    const mode = this.effectiveMode();
    const segments = segmentText(input.userText);

    try {
      const scores = await this.client.scoreBatch(segments, { timeoutMs: this.config.timeoutMs });
      if (!Array.isArray(scores) || scores.length !== segments.length) {
        throw new Error('Groq Prompt Guard returned a result count that does not match the segment count');
      }

      const segmentResults: PromptGuardSegmentResult[] = scores.map((score, segmentIndex) => ({
        segmentIndex,
        textSnippet: (segments[segmentIndex] ?? '').slice(0, SNIPPET_CHARS),
        attackScore: score.score,
      }));
      const maxScore = Math.max(...scores.map((score) => score.score));
      const flagged = maxScore >= this.config.maxAttackScore;
      const verdict: PromptGuardVerdict = flagged ? (mode === 'block' ? 'block' : 'flag') : 'pass';

      return {
        verdict,
        maxScore,
        scannedSegments: segments.length,
        model: scores[0]?.model ?? 'unknown',
        latencyMs: Date.now() - started,
        skipped: false,
        segments: segmentResults,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const skipReason = err instanceof GroqPromptGuardTimeoutError ? 'timeout' : 'api_error';
      this.reportFailOpen(err, { skipReason });
      return {
        verdict: 'flag',
        maxScore: 0.0,
        scannedSegments: 0,
        model: 'unknown',
        latencyMs: Date.now() - started,
        skipped: true,
        skipReason,
        error: err.message,
        segments: [],
      };
    }
  }

  /** Rollout safety interlock (ADR-043 §B.3): block requires gatesAccepted. */
  private effectiveMode(): PromptGuardMode {
    if (this.config.mode === 'block' && !this.config.gatesAccepted) return 'flag';
    return this.config.mode;
  }
}
