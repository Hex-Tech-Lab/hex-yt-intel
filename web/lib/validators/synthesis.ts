/**
 * Zod validation schemas for Synthesis Nucleus
 * Validates JSON fragments from the Worker stream before they touch Zustand
 *
 * ADR 006: Structured JSON Streaming (v2.0 schema)
 * - KGNodeSchema, KGEdgeSchema: Knowledge Graph entities
 * - PersonaConfigSchema: Structured persona configuration
 * - UCISPayloadV2Schema: Complete v2.0 payload for dual-write
 */

import { z } from 'zod';

/**
 * Validate individual dimension metadata
 */
const DimensionMetadataSchema = z.object({
  wordCount: z.number().optional(),
  keyTerms: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  insufficientData: z.boolean().optional(),
}).strict();

/**
 * Validate a complete dimension
 */
export const UCISDimensionSchema = z.object({
  number: z.number().int().min(1).max(11),
  name: z.string().min(1).max(100),
  content: z.string().min(10),
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

// =============================================================================
// ADR 006: Structured JSON Streaming — v2.0 Zod Schemas
// =============================================================================

/**
 * Knowledge Graph Node — emitted by LLM, validated by Zod.
 * CRITICAL: The prompt instructs the LLM to extract ONLY domain-specific
 * semantic entities (People, Concepts, Frameworks, Tools) — never structural
 * document headers like "Apex Intelligence" or "Semantic Foundation".
 */
export const KGNodeSchema = z.object({
  id: z.string().min(1).max(100),
  dimension: z.number().int().min(1).max(11),
  label: z.string().min(1).max(200),
  content: z.string().min(10),
  weight: z.number().min(0).max(1),
  polarity: z.number().min(-1).max(1),
  keyTerms: z.array(z.string()).max(10),
  entityType: z.enum([
    'person', 'concept', 'framework', 'tool',
    'organization', 'study', 'trend', 'metric'
  ]),
}).strict();

/**
 * Knowledge Graph Edge — relationship between nodes.
 */
export const KGEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  strength: z.number().min(0).max(1),
  kind: z.enum(['similar', 'related', 'tangent', 'contrarian']),
  rationale: z.string().min(5).max(500).optional(),
}).strict();

/**
 * Persona configuration — structured replacement for the text header block.
 */
export const PersonaConfigSchema = z.object({
  primary: z.object({
    id: z.enum(['creator', 'critic', 'analyst', 'educator', 'philosopher']),
    label: z.string(),
    weight: z.number().min(0).max(1),
  }),
  secondary: z.object({
    id: z.enum(['creator', 'critic', 'analyst', 'educator', 'philosopher']),
    label: z.string(),
    weight: z.number().min(0).max(1),
  }).optional(),
  tertiary: z.object({
    id: z.enum(['creator', 'critic', 'analyst', 'educator', 'philosopher']),
    label: z.string(),
    weight: z.number().min(0).max(1),
  }).optional(),
  cognitiveLenses: z.array(z.string()).min(1).max(8),
  selectionRationale: z.string().min(10).max(500),
}).strict();

/**
 * Single dimension in the JSON payload (v2.0).
 * Content is markdown (same richness as before) but properly JSON-escaped.
 */
export const UCISDimensionV2Schema = z.object({
  number: z.number().int().min(1).max(11),
  name: z.string().min(1).max(100),
  content: z.string().min(10),
  metadata: z.object({
    wordCount: z.number().optional(),
    keyTerms: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    insufficientData: z.boolean().optional(),
  }).strict().optional(),
}).strict();

/**
 * Classification data for the analysis.
 */
export const ClassificationDataSchema = z.object({
  authoritative: z.boolean(),
  practicallyActionable: z.boolean(),
  knowledgeGraphReady: z.boolean(),
  safe: z.boolean(),
  personaOptimised: z.boolean(),
  recommendation: z.enum(['highly_recommended', 'recommended', 'conditional', 'skip']),
}).strict();

/**
 * Monetization verdicts for different persona types.
 */
export const MonetizationVerdictSchema = z.object({
  creator: z.string().min(5).max(500),
  indieMaker: z.string().min(5).max(500),
  consultant: z.string().min(5).max(500),
  researcher: z.string().min(5).max(500),
  productManager: z.string().min(5).max(500),
}).strict();

/**
 * Knowledge Graph structure within the v2.0 payload.
 */
export const KnowledgeGraphSchema = z.object({
  nodes: z.array(KGNodeSchema).max(30),
  edges: z.array(KGEdgeSchema).max(100),
  rootId: z.string().nullable(),
}).strict();

/**
 * Complete structured JSON payload — v2.0 schema.
 * This is what the LLM emits and what gets persisted to analysis_payload JSONB.
 * Dual-write with analysis_markdown ensures backward compatibility.
 */
export const UCISPayloadV2Schema = z.object({
  schemaVersion: z.literal('2.0'),
  persona: PersonaConfigSchema,
  dimensions: z.array(UCISDimensionV2Schema).min(1).max(11),
  knowledgeGraph: KnowledgeGraphSchema,
  classification: ClassificationDataSchema,
  monetizationVerdict: MonetizationVerdictSchema.optional(),
}).strict();

// =============================================================================
// Stream Fragment Schema — Extended with ADR 006 fragment types
// =============================================================================

/**
 * Validate stream fragments from Worker
 * Handles: dimension, metadata, complete, error, persona, kg, classification
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

  // 'complete' and 'done' are the same terminal fragment under different names —
  // the deployed worker emits 'done', newer builds emit 'complete'. Accept both so
  // the stream's final state is never discarded regardless of worker version.
  z.object({
    type: z.literal('complete'),
    model: z.string(),
    valid: z.boolean(),
    videoId: z.string(),
    analysisId: z.string(),
  }).strict(),

  z.object({
    type: z.literal('done'),
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

  // ADR 006: New fragment types for structured JSON streaming
  z.object({
    type: z.literal('persona'),
    config: PersonaConfigSchema,
  }).strict(),

  z.object({
    type: z.literal('kg'),
    nodes: z.array(KGNodeSchema),
    edges: z.array(KGEdgeSchema),
    rootId: z.string().nullable(),
  }).strict(),

  z.object({
    type: z.literal('classification'),
    data: ClassificationDataSchema,
  }).strict(),
]);

// =============================================================================
// Safe parse helpers with detailed error reporting
// =============================================================================

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

/**
 * Safe parse for v2.0 JSON payload (ADR 006)
 */
export function validatePayloadV2(data: unknown) {
  const result = UCISPayloadV2Schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.flatten();
    console.error('[Synthesis] PayloadV2 validation failed:', errors);
  }
  return result;
}