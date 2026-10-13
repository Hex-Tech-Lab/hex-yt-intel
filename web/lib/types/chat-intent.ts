/**
 * Chat Intent & Prompt Guard Domain Types (ADR-043)
 *
 * Defines the strict, versioned closed intent set and classification payload contracts.
 */

export const CHAT_INTENTS = [
  'writing',
  'comments_lookup',
  'citation_lookup',
  'metadata',
  'general_grounded_qa',
] as const;

export type ChatIntent = (typeof CHAT_INTENTS)[number];

export interface ChatIntentClassification {
  intent: ChatIntent;
  confidence: number;
  jevVersion: string;
  rawResponse?: Record<string, unknown>;
}

export interface ResolvedTurnIntent {
  intent: ChatIntent;
  confidence: number;
  jevVersion: string;
  isInherited: boolean;
  priorIntent?: ChatIntent;
  overrideApplied: boolean;
  suppressCommentsChip: boolean;
  suppressTimestamps: boolean;
}

export type PromptGuardVerdict = 'pass' | 'flag' | 'block';

export interface PromptGuardSegmentScan {
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
  segments: PromptGuardSegmentScan[];
}

export interface GroqPromptGuardRequest {
  model: string;
  input: string;
  timeoutMs?: number;
}

export interface GroqPromptGuardResponse {
  score: number;
  model: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}
