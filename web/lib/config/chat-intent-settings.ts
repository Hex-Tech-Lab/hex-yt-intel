/**
 * Chat Intent & Prompt Guard Settings Registry Fallbacks (ADR-043)
 *
 * Keeps static in-code defaults synchronized with migration
 * 20261013190000_chat_intent_and_prompt_guard_settings.sql.
 */

import type { ChatIntent } from '../types/chat-intent';

export type PromptGuardMode = 'off' | 'flag' | 'block';
export type PromptGuardModel =
  | 'meta-llama/llama-prompt-guard-2-86m'
  | 'meta-llama/llama-prompt-guard-2-22m';

export interface ChatIntentSettings {
  'chat.intent.enabled': boolean;
  'chat.intent.overrideConfidence': number;
  'chat.intent.timeoutMs': number;
  'chat.intent.modelByIntent': Record<ChatIntent, string>;
}

export interface PromptGuardSettings {
  'chat.promptGuard.mode': PromptGuardMode;
  'chat.promptGuard.model': PromptGuardModel;
  'chat.promptGuard.maxAttackScore': number;
  'chat.promptGuard.timeoutMs': number;
  'chat.promptGuard.gatesAccepted': boolean;
}

export const CHAT_INTENT_SETTINGS_DEFAULTS: ChatIntentSettings = {
  'chat.intent.enabled': false,
  'chat.intent.overrideConfidence': 0.75,
  'chat.intent.timeoutMs': 15000,
  'chat.intent.modelByIntent': {
    writing: 'primary',
    comments_lookup: 'cheap',
    citation_lookup: 'cheap',
    metadata: 'cheap',
    general_grounded_qa: 'primary',
  },
};

export const PROMPT_GUARD_SETTINGS_DEFAULTS: PromptGuardSettings = {
  'chat.promptGuard.mode': 'off',
  'chat.promptGuard.model': 'meta-llama/llama-prompt-guard-2-86m',
  'chat.promptGuard.maxAttackScore': 0.85,
  'chat.promptGuard.timeoutMs': 5000,
  'chat.promptGuard.gatesAccepted': false,
};
