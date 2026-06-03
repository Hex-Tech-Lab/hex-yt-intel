/**
 * Zod validation schemas for Synthesis Nucleus
 * Validates JSON fragments from the Worker stream before they touch Zustand
 */

import { z } from 'zod';

/**
 * Validate individual dimension metadata
 */
const DimensionMetadataSchema = z.object({
  wordCount: z.number().optional(),
  keyTerms: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
}).strict().optional();

/**
 * Validate a complete dimension
 */
export const UCISDimensionSchema = z.object({
  number: z.number().int().min(1).max(11),
  name: z.string().min(1).max(100),
  content: z.string().min(10), // Enforce meaningful content
  metadata: DimensionMetadataSchema,
}).strict();

/**
 * Validate the complete payload
 */
export const UCISPayloadSchema = z.object({
  id: z.string().min(1),
  videoId: z.string().min(1),
  title: z.string().min(1),
  channelTitle: z.string().optional(),
  analysisAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  model: z.string(),
  detectedPersona: z.enum(['creator', 'critic', 'analyst', 'educator', 'philosopher']),
  dimensions: z.record(z.coerce.number(), UCISDimensionSchema),
  validation: z.object({
    passed: z.boolean(),
    errors: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
  }),
  streaming: z.object({
    started: z.string().datetime(),
    ended: z.string().datetime().optional(),
    interrupted: z.boolean(),
    dimensionsReceived: z.array(z.number()),
  }),
}).strict();

/**
 * Validate stream fragments from Worker
 * Handles: dimension, metadata, complete, error
 */
export const UCISStreamFragmentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    stage: z.enum(['starting', 'model', 'fallback']),
    videoId: z.string().optional(),
    model: z.string().optional(),
    from: z.string().optional(),
    error: z.string().optional(),
  }).strict(),

  z.object({
    type: z.literal('delta'),
    content: z.string(),
  }).strict(),

  z.object({
    type: z.literal('dimension'),
    dimension: z.number().int().min(1).max(11),
    name: z.string().min(1),
    content: z.string().min(10),
    metadata: DimensionMetadataSchema.optional(),
  }).strict(),

  z.object({
    type: z.literal('metadata'),
    model: z.string().optional(),
    persona: z.enum(['creator', 'critic', 'analyst', 'educator', 'philosopher']).optional(),
  }).strict(),

  z.object({
    type: z.literal('complete'),
    model: z.string(),
    valid: z.boolean(),
    videoId: z.string(),
    analysisId: z.string(),
  }).strict(),

  z.object({
    type: z.literal('error'),
    error: z.string(),
    code: z.string().optional(),
  }).strict(),
]);

/**
 * Safe parse with detailed error reporting
 */
export function validateDimension(data: unknown) {
  const result = UCISDimensionSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    console.warn('[Synthesis] Dimension validation failed:', errors, data);
  }
  return result;
}

export function validateFragment(data: unknown) {
  const result = UCISStreamFragmentSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.flatten();
    console.warn('[Synthesis] Fragment validation failed:', errors, data);
  }
  return result;
}

export function validatePayload(data: unknown) {
  const result = UCISPayloadSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.flatten();
    console.error('[Synthesis] Payload validation failed:', errors);
  }
  return result;
}
