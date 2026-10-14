/**
 * ChatIntentRouterPort — Domain Port (Hexagonal-Lite)
 *
 * Directs incoming chat turns to appropriate intent archetypes and model tiers (ADR-043).
 * Classifies raw user text via Jev Decisions API with confidence evaluation and prior-turn inheritance.
 */

export const VALID_CHAT_INTENTS = [
  'writing',
  'comments_lookup',
  'citation_lookup',
  'metadata',
  'general_grounded_qa',
] as const;

export type ChatIntent = (typeof VALID_CHAT_INTENTS)[number];

export interface ChatIntentInput {
  currentMessage: string;
  priorIntent?: ChatIntent;
  historyLength: number;
  videoId?: string;
  analysisId?: string;
}

export interface ChatIntentOutput {
  intent: ChatIntent;
  confidence: number;
  jevVersion: string;
  isInherited: boolean;
  priorIntent?: ChatIntent;
  overrideApplied: boolean;
  suppressCommentsChip: boolean;
  suppressTimestamps: boolean;
}

export interface ChatIntentRouterPort {
  /**
   * Evaluates a turn and resolves its active intent contract.
   * If Jev is disabled or times out, falls back gracefully without throwing.
   */
  resolveTurnIntent(input: ChatIntentInput): Promise<ChatIntentOutput>;
}
