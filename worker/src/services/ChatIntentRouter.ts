/**
 * ChatIntentRouter — Domain Service for Intent Classification (ADR-043 Scaffolding)
 *
 * Implements ChatIntentRouterPort. Uses OpenRouter Decisions API (`~typesafe/jev-latest`)
 * with inheritance rules and fail-open fallbacks.
 * Advance Scout stub: CCT will implement full Jev Decisions payload construction and live dispatch.
 */

import type {
  ChatIntentRouterPort,
  ChatIntentInput,
  ChatIntentOutput,
  ChatIntent,
} from '../ports/ChatIntentRouterPort';

export interface ChatIntentRouterConfig {
  openRouterApiKey: string;
  enabled: boolean;
  overrideConfidence: number;
  timeoutMs: number;
}

export class ChatIntentRouter implements ChatIntentRouterPort {
  private readonly config: ChatIntentRouterConfig;

  constructor(config: ChatIntentRouterConfig) {
    this.config = config;
  }

  /**
   * Resolves the active intent contract for a chat turn.
   * If intent router is disabled, defaults to 'general_grounded_qa'.
   */
  public async resolveTurnIntent(input: ChatIntentInput): Promise<ChatIntentOutput> {
    if (!this.config.enabled) {
      return {
        intent: 'general_grounded_qa',
        confidence: 1.0,
        jevVersion: 'disabled',
        isInherited: false,
        overrideApplied: false,
        suppressCommentsChip: false,
        suppressTimestamps: false,
      };
    }

    // Advance Scout Stub: CCT will connect live Jev Decision calls.
    throw new Error('ChatIntentRouter.resolveTurnIntent: Not implemented (scaffolded for CCT Wave 2 implementation)');
  }
}
