import { z } from 'zod';

/**
 * Zod Schemas for UCIS v2.0 Payload Validation
 * ADR 006: Structured JSON Streaming Blueprint
 */

export const KGNodeSchema = z.object({
  id: z.string(),
  dimension: z.number(),
  label: z.string(),
  content: z.string(),
  weight: z.number(),
  polarity: z.number(),
  keyTerms: z.array(z.string()),
  entityType: z.enum([
    'person', 
    'concept', 
    'framework', 
    'tool', 
    'organization', 
    'study', 
    'trend', 
    'metric'
  ]).optional().default('concept'),
}).passthrough();

export const KGEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  strength: z.number(),
  kind: z.enum(['similar', 'related', 'tangent', 'contrarian']),
  rationale: z.string().optional(),
}).passthrough();

export const PersonaConfigSchema = z.object({
  primary: z.object({
    id: z.string(),
    label: z.string(),
    weight: z.number(),
  }).passthrough(),
  secondary: z.object({
    id: z.string(),
    label: z.string(),
    weight: z.number(),
  }).passthrough().optional(),
  tertiary: z.object({
    id: z.string(),
    label: z.string(),
    weight: z.number(),
  }).passthrough().optional(),
  cognitiveLenses: z.array(z.string()),
  selectionRationale: z.string(),
}).passthrough();

export const UCISDimensionSchema = z.object({
  number: z.number(),
  name: z.string(),
  content: z.string(),
  metadata: z.object({
    wordCount: z.number().optional(),
    keyTerms: z.array(z.string()).optional(),
    confidence: z.number().optional(),
    insufficientData: z.boolean().optional(),
  }).passthrough().optional(),
}).passthrough();

export const UCISPayloadSchema = z.object({
  schemaVersion: z.literal('2.0'),
  persona: PersonaConfigSchema,
  dimensions: z.array(UCISDimensionSchema),
  knowledgeGraph: z.object({
    nodes: z.array(KGNodeSchema),
    edges: z.array(KGEdgeSchema),
    rootId: z.string().nullable(),
  }).passthrough().optional().nullable(),
  classification: z.object({
    authoritative: z.boolean(),
    practicallyActionable: z.boolean(),
    knowledgeGraphReady: z.boolean(),
    safe: z.boolean(),
    personaOptimised: z.boolean(),
    recommendation: z.string(),
  }).passthrough(),
  monetizationVerdict: z.object({
    creator: z.string().optional(),
    indieMaker: z.string().optional(),
    consultant: z.string().optional(),
    researcher: z.string().optional(),
    productManager: z.string().optional(),
  }).passthrough().optional().nullable(),
}).passthrough();

export const ChunkPayloadSchema = z.object({
  schemaVersion: z.literal('2.0'),
  dimensions: z.array(z.any()),
}).passthrough();

