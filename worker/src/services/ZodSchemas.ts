import { z } from 'zod';

/**
 * Zod Schemas for UCIS v2.0 Payload Validation
 * ADR 006: Structured JSON Streaming Blueprint
 */

export const CaseInsensitiveEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z.preprocess(
    (val) => (typeof val === "string" ? val.trim().toLowerCase() : val),
    z.enum(values)
  );

export const KGNodeSchema = z.object({
  id: z.string(),
  dimension: z.number(),
  label: z.string(),
  content: z.string().optional(),
  weight: z.number(),
  polarity: z.number(),
  keyTerms: z.array(z.string()),
  entityType: CaseInsensitiveEnum(["person", "organization", "location", "event", "object", "concept", "topic"]).optional().default('concept'),
}).passthrough();

export const KGEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  strength: z.number(),
  kind: CaseInsensitiveEnum(['similar', 'related', 'tangent', 'contrarian']),
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


export const MAX_KG_NODES = 24;
// USER STANDARD (2026-09-28): 24 nodes / 18 edges (ROE spec) — supersedes the
// telemetry-derived 24. Persist-side schema must mirror the web contract.
export const MAX_KG_EDGES = 18;

export const KnowledgeGraphSchema = z.preprocess(
  (val: unknown) => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
    const out = { ...(val as Record<string, unknown>) };
    if (Array.isArray(out.nodes)) {
      out.nodes = out.nodes.slice(0, MAX_KG_NODES);
    }
    if (Array.isArray(out.edges)) {
      out.edges = out.edges.slice(0, MAX_KG_EDGES);
    }
    return out;
  },
  z.object({
    nodes: z.array(KGNodeSchema).max(MAX_KG_NODES),
    edges: z.array(KGEdgeSchema).max(MAX_KG_EDGES),
    rootId: z.string().nullable(),
  }).passthrough()
);

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
  knowledgeGraph: KnowledgeGraphSchema.optional().nullable(),
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
  dimensions: z.array(UCISDimensionSchema),
  // R1b (2026-09-29): sub-dimension 8.3 Cross-Domain Bridges, carried by the
  // PROJECTIVE bundle as a top-level root field (it belongs to no emitted
  // dimension object). Validated as markdown text and merged into dimension
  // 8's content client-side at the stitch step. Display text only; the
  // char cap (analysis.layer2.crossDomainBridgesMaxChars) is enforced at the
  // stitch step, not here.
  crossDomainBridges: z.string().min(1).optional(),
  // R1e (2026-09-29): markdown body of UCIS sub-dimension 8.4 Discovery
  // Pathways, carried by the PROJECTIVE bundle as a top-level root field and
  // merged into dimension 8's content client-side at the stitch step.
  // Display text only; the char cap (analysis.layer2.crossDomainBridgesMaxChars)
  // is enforced at the stitch step, not here.
  discoveryPathways: z.string().min(1).optional(),
  // R1e (2026-09-29): resources/tools/further reading the speaker EXPLICITLY
  // names in the transcript, emitted by the GROUNDED bundle containing dim 8
  // as a top-level root field. Intermediate handoff input for the projective
  // bundle's 8.4 Discovery Pathways — stripped at the stitch step, never
  // persisted into the final payload.
  explicitSpeakerResources: z.array(z.string().max(200)).max(20).optional(),
}).passthrough();
