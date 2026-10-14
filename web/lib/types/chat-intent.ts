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

/** Version of the SSE `meta` intent contract. Bump on any shape change. */
export const CHAT_INTENT_VERSION = 1;

export const MODEL_TIERS = ['primary', 'cheap'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/**
 * Per-turn intent contract carried on the worker SSE `meta` frame. Computed once
 * per turn by the worker; the browser reads it and never re-derives intent.
 */
export interface ChatTurnIntentMeta {
  intent: ChatIntent;
  suppressCommentsChip: boolean;
  suppressTimestamps: boolean;
  modelTier: ModelTier;
  intentVersion: number;
}

/**
 * Registry-resolved router settings relayed from the Vercel bouncer. Bound into the
 * stream HMAC digest, so the browser cannot edit them. Present only when enabled.
 */
export interface ChatIntentConfigPayload {
  enabled: true;
  overrideConfidence: number;
  timeoutMs: number;
  modelByIntent: Record<string, ModelTier>;
}

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
