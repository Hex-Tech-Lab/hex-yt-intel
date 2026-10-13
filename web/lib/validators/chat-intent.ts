/**
 * Zod Validation Schemas for Chat Intent Router and Prompt Guard (ADR-043)
 *
 * Enforces strict boundary validation at API entry points, worker streams, and settings resolution.
 */

import { z } from 'zod';
import { CHAT_INTENTS } from '../types/chat-intent';

/**
 * Strict Zod Schema for the closed Chat Intent enumeration.
 * Must strictly equal: writing | comments_lookup | citation_lookup | metadata | general_grounded_qa.
 */
export const ChatIntentSchema = z.enum(CHAT_INTENTS);

/**
 * Schema for raw Jev classification result from the OpenRouter Decisions API.
 */
export const ChatIntentClassificationSchema = z
  .object({
    intent: ChatIntentSchema,
    confidence: z.number().min(0).max(1),
    jevVersion: z.string().min(1),
    rawResponse: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Schema for resolved turn intent after inheritance evaluation and rule gating.
 */
export const ResolvedTurnIntentSchema = z
  .object({
    intent: ChatIntentSchema,
    confidence: z.number().min(0).max(1),
    jevVersion: z.string().min(1),
    isInherited: z.boolean(),
    priorIntent: ChatIntentSchema.optional(),
    overrideApplied: z.boolean(),
    suppressCommentsChip: z.boolean(),
    suppressTimestamps: z.boolean(),
  })
  .strict();

/**
 * Prompt Guard operational modes.
 */
export const PromptGuardModeSchema = z.enum(['off', 'flag', 'block']);

/**
 * Prompt Guard screening verdicts.
 */
export const PromptGuardVerdictSchema = z.enum(['pass', 'flag', 'block']);

/**
 * Prompt Guard single segment scan result.
 */
export const PromptGuardSegmentScanSchema = z
  .object({
    segmentIndex: z.number().int().min(0),
    textSnippet: z.string(),
    attackScore: z.number().min(0).max(1),
  })
  .strict();

/**
 * Prompt Guard complete turn evaluation result.
 */
export const PromptGuardResultSchema = z
  .object({
    verdict: PromptGuardVerdictSchema,
    maxScore: z.number().min(0).max(1),
    scannedSegments: z.number().int().min(0),
    model: z.string().min(1),
    latencyMs: z.number().min(0),
    skipped: z.boolean(),
    skipReason: z.enum(['mode_off', 'empty_input', 'api_error', 'timeout']).optional(),
    error: z.string().optional(),
    segments: z.array(PromptGuardSegmentScanSchema),
  })
  .strict();

/**
 * Groq Prompt Guard API response validator.
 */
export const GroqPromptGuardResponseSchema = z
  .object({
    score: z.number().min(0).max(1),
    model: z.string(),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();
