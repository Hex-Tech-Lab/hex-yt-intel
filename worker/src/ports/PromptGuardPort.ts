/**
 * PromptGuardPort — Domain Port (Hexagonal-Lite)
 *
 * Screens user-authored input for prompt injections and jailbreaks via Groq Llama Prompt Guard (ADR-043).
 * Operates on sliding 512-token windows with fail-open semantics on network or API failures.
 */

export type PromptGuardMode = 'off' | 'flag' | 'block';
export type PromptGuardVerdict = 'pass' | 'flag' | 'block';

export interface PromptGuardScreenInput {
  userText: string;
  userId?: string;
  conversationId?: string;
}

export interface PromptGuardSegmentResult {
  segmentIndex: number;
  textSnippet: string;
  attackScore: number;
}

export interface PromptGuardResult {
  verdict: PromptGuardVerdict;
  maxScore: number;
  scannedSegments: number;
  model: string;
  latencyMs: number;
  skipped: boolean;
  skipReason?: 'mode_off' | 'empty_input' | 'api_error' | 'timeout';
  error?: string;
  segments: PromptGuardSegmentResult[];
}

export interface PromptGuardPort {
  /**
   * Evaluates user input against Prompt Guard.
   * Never throws on classifier outage — returns fail-open verdict ('flag' or 'pass') with error metadata.
   */
  screenInput(input: PromptGuardScreenInput): Promise<PromptGuardResult>;
}
