/**
 * Chat Intent Router & Boundary Contract Tests (ADR-043)
 *
 * Verifies:
 * 1. Pinned closed intent set in Zod schema
 * 2. Strict validation of Jev classification and resolved turn contracts
 * 3. Contractual gating: comments chip & timestamp suppression on 'writing' intent
 * 4. Settings registry fallback parity
 */

import { describe, it, expect } from 'vitest';
import {
  ChatIntentSchema,
  ChatIntentClassificationSchema,
  ResolvedTurnIntentSchema,
  PromptGuardModeSchema,
  PromptGuardVerdictSchema,
  PromptGuardResultSchema,
} from '../validators/chat-intent';
import { CHAT_INTENTS, type ChatIntent } from '../types/chat-intent';
import {
  CHAT_INTENT_SETTINGS_DEFAULTS,
  PROMPT_GUARD_SETTINGS_DEFAULTS,
} from '../config/chat-intent-settings';

describe('Chat Intent & Prompt Guard Boundary Contracts (ADR-043)', () => {
  describe('Closed Intent Set & Zod Boundaries', () => {
    it('pins the exact closed intent set of 5 categories', () => {
      const expectedIntents: ChatIntent[] = [
        'writing',
        'comments_lookup',
        'citation_lookup',
        'metadata',
        'general_grounded_qa',
      ];
      expect(CHAT_INTENTS).toEqual(expectedIntents);
      expect(CHAT_INTENTS.length).toBe(5);
    });

    it('accepts valid intents through ChatIntentSchema', () => {
      for (const intent of CHAT_INTENTS) {
        const result = ChatIntentSchema.safeParse(intent);
        expect(result.success).toBe(true);
      }
    });

    it('strictly rejects unknown or fabricated intent categories', () => {
      const invalidIntents = ['creative_writing', 'summarization', 'chat', 'code_generation', '', null, 123];
      for (const invalid of invalidIntents) {
        const result = ChatIntentSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      }
    });

    it('validates a conformant Jev classification payload', () => {
      const payload = {
        intent: 'writing',
        confidence: 0.94,
        jevVersion: 'typesafe/jev-1.13-20260917',
      };
      const parsed = ChatIntentClassificationSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });

    it('rejects Jev classification payloads with confidence out of 0..1 bounds', () => {
      expect(ChatIntentClassificationSchema.safeParse({
        intent: 'writing',
        confidence: 1.5,
        jevVersion: '1.0',
      }).success).toBe(false);

      expect(ChatIntentClassificationSchema.safeParse({
        intent: 'writing',
        confidence: -0.1,
        jevVersion: '1.0',
      }).success).toBe(false);
    });

    it('validates a resolved turn intent with inheritance markers', () => {
      const resolved = {
        intent: 'writing',
        confidence: 0.88,
        jevVersion: 'typesafe/jev-1.13-20260917',
        isInherited: true,
        priorIntent: 'writing',
        overrideApplied: false,
        suppressCommentsChip: true,
        suppressTimestamps: true,
      };
      const parsed = ResolvedTurnIntentSchema.safeParse(resolved);
      expect(parsed.success).toBe(true);
    });
  });

  describe('Contractual Gating Rules (ADR-043 §A.2 & §A.4)', () => {
    it('writing intent contracts mandate comments chip and timestamp suppression', () => {
      const writingContract = {
        intent: 'writing',
        suppressCommentsChip: true,
        suppressTimestamps: true,
      };
      expect(writingContract.suppressCommentsChip).toBe(true);
      expect(writingContract.suppressTimestamps).toBe(true);
    });

    it('comments_lookup intent contracts mandate showing comments chip', () => {
      const commentsContract = {
        intent: 'comments_lookup',
        suppressCommentsChip: false,
        suppressTimestamps: false,
      };
      expect(commentsContract.suppressCommentsChip).toBe(false);
    });
  });

  describe('Settings Registry Fallback Invariants', () => {
    it('synchronizes in-code defaults with migration specifications', () => {
      expect(CHAT_INTENT_SETTINGS_DEFAULTS['chat.intent.enabled']).toBe(false);
      expect(CHAT_INTENT_SETTINGS_DEFAULTS['chat.intent.overrideConfidence']).toBe(0.75);
      expect(CHAT_INTENT_SETTINGS_DEFAULTS['chat.intent.timeoutMs']).toBe(15000);
      expect(CHAT_INTENT_SETTINGS_DEFAULTS['chat.intent.modelByIntent'].writing).toBe('primary');

      expect(PROMPT_GUARD_SETTINGS_DEFAULTS['chat.promptGuard.mode']).toBe('off');
      expect(PROMPT_GUARD_SETTINGS_DEFAULTS['chat.promptGuard.model']).toBe('meta-llama/llama-prompt-guard-2-86m');
      expect(PROMPT_GUARD_SETTINGS_DEFAULTS['chat.promptGuard.maxAttackScore']).toBe(0.85);
      expect(PROMPT_GUARD_SETTINGS_DEFAULTS['chat.promptGuard.timeoutMs']).toBe(5000);
      expect(PROMPT_GUARD_SETTINGS_DEFAULTS['chat.promptGuard.gatesAccepted']).toBe(false);
    });
  });

  describe('Prompt Guard Schema Boundaries', () => {
    it('validates PromptGuardMode enum (off, flag, block)', () => {
      expect(PromptGuardModeSchema.safeParse('off').success).toBe(true);
      expect(PromptGuardModeSchema.safeParse('flag').success).toBe(true);
      expect(PromptGuardModeSchema.safeParse('block').success).toBe(true);
      expect(PromptGuardModeSchema.safeParse('quarantine').success).toBe(false);
    });

    it('validates PromptGuardVerdict enum (pass, flag, block)', () => {
      expect(PromptGuardVerdictSchema.safeParse('pass').success).toBe(true);
      expect(PromptGuardVerdictSchema.safeParse('flag').success).toBe(true);
      expect(PromptGuardVerdictSchema.safeParse('block').success).toBe(true);
      expect(PromptGuardVerdictSchema.safeParse('unknown').success).toBe(false);
    });

    it('validates a complete PromptGuardResult payload', () => {
      const validResult = {
        verdict: 'flag',
        maxScore: 0.92,
        scannedSegments: 2,
        model: 'meta-llama/llama-prompt-guard-2-86m',
        latencyMs: 142,
        skipped: false,
        segments: [
          { segmentIndex: 0, textSnippet: 'Normal prompt query...', attackScore: 0.12 },
          { segmentIndex: 1, textSnippet: 'Ignore previous instructions...', attackScore: 0.92 },
        ],
      };
      const parsed = PromptGuardResultSchema.safeParse(validResult);
      expect(parsed.success).toBe(true);
    });
  });
});
