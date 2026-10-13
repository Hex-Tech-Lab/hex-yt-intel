/**
 * PromptGuard — Domain Service for Input Injection Screening (ADR-043 Scaffolding)
 *
 * Implements PromptGuardPort. Manages sliding window segmentation (512 tokens with overlap),
 * parallel Groq client evaluation, max score aggregation, and fail-open resilience.
 * Advance Scout stub: CCT will implement full sliding window and decision matrix.
 */

import type {
  PromptGuardPort,
  PromptGuardScreenInput,
  PromptGuardResult,
  PromptGuardMode,
} from '../ports/PromptGuardPort';
import type { IGroqPromptGuardClient } from './GroqPromptGuardClient';

export interface PromptGuardServiceConfig {
  mode: PromptGuardMode;
  maxAttackScore: number;
  gatesAccepted: boolean;
  timeoutMs: number;
}

export class PromptGuard implements PromptGuardPort {
  private readonly client: IGroqPromptGuardClient;
  private readonly config: PromptGuardServiceConfig;

  constructor(client: IGroqPromptGuardClient, config: PromptGuardServiceConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Evaluates user input against Prompt Guard.
   * If mode === 'off', returns immediately without calling Groq.
   * If error occurs, fails open to avoid blocking user chat.
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

    // Advance Scout Stub: CCT will implement sliding window and scoring logic.
    throw new Error('PromptGuard.screenInput: Not implemented (scaffolded for CCT Wave 2 implementation)');
  }
}
