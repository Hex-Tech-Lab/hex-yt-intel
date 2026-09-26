/**
 * Zod validation schemas for Synthesis Nucleus
 * Validates JSON fragments from the Worker stream before they touch Zustand
 *
 * ADR 006: Structured JSON Streaming (v2.0 schema)
 * - KGNodeSchema, KGEdgeSchema: Knowledge Graph entities
 * - PersonaConfigSchema: Structured persona configuration
 * - UCISPayloadV2Schema: Complete v2.0 payload for dual-write
 */

import { z } from "zod";
import { TOTAL_DIMENSIONS } from "@/lib/config/synthesis";

/**
 * Validate individual dimension metadata
 */
const DimensionMetadataSchema = z
  .object({
    wordCount: z.number().optional(),
    keyTerms: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    insufficientData: z.boolean().optional(),
  })
  .strict();

/**
 * Validate a complete dimension
 * Dimension 0 is the Executive Digest (ADR 010), dimensions 1-11 are main analysis.
 */
export const UCISDimensionSchema = z
  .object({
    number: z.number().int().min(0).max(TOTAL_DIMENSIONS),
    name: z.string().min(1).max(100),
    content: z.string().min(10),
    metadata: DimensionMetadataSchema.optional(),
  })
  .strict();

/**
 * Validate the complete payload
 */
export const UCISPayloadSchema = z
  .object({
    id: z.string().min(1),
    videoId: z.string().min(1),
    title: z.string().min(1),
    channelTitle: z.string().optional(),
    analysisAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    model: z.string(),
    detectedPersona: z.enum([
      "creator",
      "indieMaker",
      "consultant",
      "researcher",
      "productManager",
    ]),
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
  })
  .strict();

// =============================================================================
// ADR 006: Structured JSON Streaming — v2.0 Zod Schemas
// =============================================================================

/**
 * Knowledge Graph Node — emitted by LLM, validated by Zod.
 * CRITICAL: The prompt instructs the LLM to extract ONLY domain-specific
 * semantic entities (People, Concepts, Frameworks, Tools) — never structural
 * document headers like "Apex Intelligence" or "Semantic Foundation".
 * Dimension 0 is the Executive Digest (ADR 010), dimensions 1-11 are main analysis.
 */
/**
 * Normalize the KG node `type`/`entityType` key duality.
 * RCA (2026-09-25, live production, video 4mTLpuQpB80): the prompt's
 * Dimension 8.1 instructs the model to emit a `type` key while the JSON
 * envelope example says `entityType` -- the model emits BOTH keys. The
 * former strict() schema rejected every node carrying `type`
 * (unrecognized_keys), dropping the whole kg fragment client-side and every
 * node at the stitch boundary (Sentry "Validation dropped payload at
 * stitch-analysis-chunks (node)").
 */
const normalizeNodeEntityKey = (val: unknown): unknown => {
  if (!val || typeof val !== "object" || Array.isArray(val)) return val;
  const out: Record<string, unknown> = { ...(val as Record<string, unknown>) };
  if ("type" in out) {
    if (!("entityType" in out) || out.entityType === undefined) {
      out.entityType = out.type;
    }
    delete out.type;
  }
  return out;
};

export const KGNodeSchema = z.preprocess(
  normalizeNodeEntityKey,
  z
    .object({
      id: z.string().min(1).max(100),
      dimension: z.number().int().min(0).max(TOTAL_DIMENSIONS),
      label: z.string().min(1).max(200),
      // Optional: the prompt's authoritative node spec (Dimension 8.1) asks
      // only for label/type/weight -- it never asks for `content` (that
      // field exists only in the envelope example), so real model output
      // omits it. Every consumer already tolerates absence (`n.content || ''`
      // in useKnowledgeGraph.ts).
      content: z.string().optional(),
      weight: z.number().min(0.1).max(10.0),
      polarity: z.number().min(-1).max(1),
      keyTerms: z.array(z.string()).max(10),
      entityType: z.enum([
        "person",
        "concept",
        "framework",
        "tool",
        "organization",
        "study",
        "trend",
        "metric",
        "Person",
        "Organization",
        "Location",
        "Event",
        "Object",
      ]),
    })
    .strict(),
);

/**
 * Knowledge Graph Edge — relationship between nodes.
 */
export const KGEdgeSchema = z
  .object({
    source: z.string().min(1),
    target: z.string().min(1),
    // 1-10, per the prompt's own instruction (ucis-v5.3.ts: "strength:
    // Connection strength (1-10)") -- see weight above for why this cap
    // matters: it was the actual cause of complete analyses being marked
    // partial/failed.
    strength: z.number().min(1).max(10),
    kind: z.enum(["similar", "related", "tangent", "contrarian"]),
    rationale: z.string().min(5).max(500).optional(),
  })
  .strict();

/**
 * Persona configuration — structured replacement for the text header block.
 */
export const TolerantPersonaId = z.preprocess((val) => {
  if (typeof val !== "string") return val;
  const normalized = val.trim().toLowerCase();
  if (normalized === "content_creator" || normalized === "creator") return "creator";
  if (normalized === "indie_maker" || normalized === "indiemaker") return "indieMaker";
  if (normalized === "consultant") return "consultant";
  if (normalized === "researcher") return "researcher";
  if (normalized === "product_manager" || normalized === "productmanager") return "productManager";
  return val;
}, z.enum(["creator", "indieMaker", "consultant", "researcher", "productManager"]));

export function normalizePersonaId(val: unknown): string {
  const parseResult = TolerantPersonaId.safeParse(val);
  if (parseResult.success) {
    return parseResult.data;
  }
  return 'creator';
}

const PersonaSlotSchema = z.object({
  id: TolerantPersonaId,
  label: z.string(),
  weight: z.number().min(0).max(1),
});

/**
 * Canonicalize the model's Tier-2 persona slot key variants into tier2A/tier2B.
 * RCA (2026-09-25, live production, video 4mTLpuQpB80): the prompt's markdown
 * persona header template instructs "Tier-2 Persona A/B" and the model
 * legitimately carries those two extra slots into its JSON persona config --
 * observed live spellings across persisted rows: tier2A, tier2a, tier2_a,
 * tier2B, tier2_b. The former strict() schema rejected every persona config
 * containing them (unrecognized_keys), dropping the fragment client-side and
 * forcing the server-side strip-retry loop on every stitched payload.
 */
const PERSONA_TIER2_VARIANTS: Array<{ variants: string[]; canonical: "tier2A" | "tier2B" }> = [
  { variants: ["tier2a", "tier2_a"], canonical: "tier2A" },
  { variants: ["tier2b", "tier2_b"], canonical: "tier2B" },
];

const normalizePersonaTier2Keys = (val: unknown): unknown => {
  if (!val || typeof val !== "object" || Array.isArray(val)) return val;
  const out: Record<string, unknown> = { ...(val as Record<string, unknown>) };
  for (const { variants, canonical } of PERSONA_TIER2_VARIANTS) {
    for (const variant of variants) {
      if (variant in out) {
        if (!(canonical in out)) out[canonical] = out[variant];
        delete out[variant];
      }
    }
  }
  return out;
};

export const PersonaConfigSchema = z.preprocess(
  normalizePersonaTier2Keys,
  z
    .object({
      primary: PersonaSlotSchema,
      secondary: PersonaSlotSchema.optional(),
      tertiary: PersonaSlotSchema.optional(),
      tier2A: PersonaSlotSchema.optional(),
      tier2B: PersonaSlotSchema.optional(),
      cognitiveLenses: z.array(z.string()).min(1).max(8),
      selectionRationale: z.string().min(10).max(500),
    })
    .strict(),
);

/**
 * Single dimension in the JSON payload (v2.0).
 * Content is markdown (same richness as before) but properly JSON-escaped.
 * Dimension 0 is the Executive Digest (ADR 010), dimensions 1-11 are main analysis.
 */
export const UCISDimensionV2Schema = z
  .object({
    number: z.number().int().min(0).max(TOTAL_DIMENSIONS),
    name: z.string().min(1).max(100),
    content: z.string().min(10),
    metadata: z
      .object({
        wordCount: z.number().optional(),
        keyTerms: z.array(z.string()).optional(),
        confidence: z.number().min(0).max(1).optional(),
        insufficientData: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Classification data for the analysis.
 */
export const ClassificationDataSchema = z
  .object({
    authoritative: z.boolean(),
    practicallyActionable: z.boolean(),
    knowledgeGraphReady: z.boolean(),
    safe: z.boolean(),
    personaOptimised: z.boolean(),
    recommendation: z.enum([
      "highly_recommended",
      "recommended",
      "conditional",
      "skip",
    ]),
  })
  .strict();

/**
 * Monetization verdicts for different persona types.
 */
export const MonetizationVerdictSchema = z
  .object({
    creator: z.string().min(5).max(500),
    indieMaker: z.string().min(5).max(500),
    consultant: z.string().min(5).max(500),
    researcher: z.string().min(5).max(500),
    productManager: z.string().min(5).max(500),
  })
  .strict();

/**
 * Knowledge Graph structure within the v2.0 payload.
 */
export const MAX_KG_NODES = 24;
// Derived from production data (2026-09-25): across 88 completed analyses the
// observed per-bundle/stitched edge count is p50=15, p90=20, max=20 -- the
// previous 18 cap rejected 31/88 rows' real output (the model is under no
// edge-count cap in the prompt). 20 observed max + ~20% margin = 24.
export const MAX_KG_EDGES = 24;

export const KnowledgeGraphSchema = z
  .object({
    nodes: z.array(KGNodeSchema).max(MAX_KG_NODES),
    edges: z.array(KGEdgeSchema).max(MAX_KG_EDGES),
    rootId: z.string().nullable(),
  })
  .strict();

/**
 * Complete structured JSON payload — v2.0 schema.
 * This is what the LLM emits and what gets persisted to analysis_payload JSONB.
 * Dual-write with analysis_markdown ensures backward compatibility.
 */
export const UCISPayloadV2Schema = z
  .object({
    schemaVersion: z.literal("2.0"),
    persona: PersonaConfigSchema,
    dimensions: z.array(UCISDimensionV2Schema).min(1).max(TOTAL_DIMENSIONS),
    knowledgeGraph: KnowledgeGraphSchema,
    classification: ClassificationDataSchema,
    monetizationVerdict: MonetizationVerdictSchema.optional(),
    videoMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
    channelMeta: z.record(z.string(), z.unknown()).nullable().optional(),
    comments: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  })
  .strict();

// =============================================================================
// Stream Fragment Schema — Extended with ADR 006 fragment types
// =============================================================================

/**
 * Validate stream fragments from Worker
 * Handles: dimension, metadata, complete, error, persona, kg, classification
 */
export const UCISStreamFragmentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("status"),
      stage: z.enum(["extracting", "starting", "model", "fallback"]),
      videoId: z.string().optional(),
      model: z.string().optional(),
      from: z.string().optional(),
      error: z.string().optional(),
      rawError: z.string().optional(),
    })
    .strict(),

  z
    .object({
      type: z.literal("delta"),
      content: z.string(),
    })
    .strict(),

  z
    .object({
      type: z.literal("dimension"),
      dimension: z.number().int().min(0).max(TOTAL_DIMENSIONS),
      name: z.string().min(1),
      content: z.string().min(10),
      metadata: DimensionMetadataSchema.optional(),
    })
    .strict(),

  z
    .object({
      type: z.literal("metadata"),
      model: z.string().optional(),
      persona: z
        .enum([
          "creator",
          "indieMaker",
          "consultant",
          "researcher",
          "productManager",
        ])
        .optional(),
    })
    .strict(),

  // 'complete' and 'done' are the same terminal fragment under different names —
  // the deployed worker emits 'done', newer builds emit 'complete'. Accept both so
  // the stream's final state is never discarded regardless of worker version.
  z
    .object({
      type: z.literal("complete"),
      model: z.string(),
      valid: z.boolean(),
      videoId: z.string(),
      analysisId: z.string(),
    })
    .strict(),

  z
    .object({
      type: z.literal("done"),
      model: z.string(),
      valid: z.boolean(),
      videoId: z.string(),
      analysisId: z.string(),
    })
    .strict(),

  z
    .object({
      type: z.literal("error"),
      error: z.string(),
      code: z.string().optional(),
    })
    .strict(),

  // ADR 006: New fragment types for structured JSON streaming
  z
    .object({
      type: z.literal("persona"),
      config: PersonaConfigSchema,
    })
    .strict(),

  z
    .object({
      type: z.literal("kg"),
      nodes: z.array(KGNodeSchema).max(MAX_KG_NODES),
      edges: z.array(KGEdgeSchema).max(MAX_KG_EDGES),
      rootId: z.string().nullable(),
    })
    .strict(),

  z
    .object({
      type: z.literal("classification"),
      data: ClassificationDataSchema,
    })
    .strict(),
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
    console.warn("[Synthesis] Dimension validation failed:", errors, data);
  }
  return result;
}

export function validateFragment(data: unknown) {
  const result = UCISStreamFragmentSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.flatten();
    console.warn("[Synthesis] Fragment validation failed:", errors, data);
  }
  return result;
}

export function validatePayload(data: unknown) {
  const result = UCISPayloadSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.flatten();
    console.error("[Synthesis] Payload validation failed:", errors);
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
    console.error("[Synthesis] PayloadV2 validation failed:", errors);
  }
  return result;
}
