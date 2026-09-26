/**
 * Regression fixtures for the 2026-09-25 persona/kg fragment drops.
 *
 * Live evidence (video 4mTLpuQpB80, analysis 56a6ec01, 5-bundle stream):
 * - Chunk 1's persona carried tier2A/tier2B slots (the prompt's markdown
 *   persona header has always asked for "Tier-2 Persona A/B") ->
 *   PersonaConfigSchema.strict() rejected them (unrecognized_keys) ->
 *   "[Adapter] Fragment validation failed, skipping".
 * - Chunk 2's knowledgeGraph nodes carried a stray `type` key (prompt
 *   Dimension 8.1 says `type`, envelope says `entityType` -> model emits
 *   BOTH) and omitted `content` (8.1 never asks for it) ->
 *   KGNodeSchema.strict() rejected every node; 20 edges also exceeded the
 *   old MAX_KG_EDGES=18 cap -> kg fragment dropped client-side AND
 *   "Validation dropped payload at stitch-analysis-chunks (node)" xN.
 *
 * Shapes below are the real production payloads (persisted chunk payloads
 * queried from Supabase analysis_chunks), trimmed to the fields relevant to
 * the contract.
 */
import { describe, it, expect } from "vitest";
import {
  validateFragment,
  UCISPayloadV2Schema,
  KGNodeSchema,
  MAX_KG_EDGES,
} from "@/lib/validators/synthesis";

const REAL_PERSONA_WITH_TIER2 = {
  tier2A: { id: "researcher", label: "Researcher", weight: 0.05 },
  tier2B: { id: "productManager", label: "Product Manager", weight: 0.05 },
  primary: { id: "creator", label: "Content Creator", weight: 0.5 },
  tertiary: { id: "consultant", label: "Consultant", weight: 0.15 },
  secondary: { id: "indieMaker", label: "Indie Maker", weight: 0.25 },
  cognitiveLenses: [
    "First Principles",
    "Systems Thinking",
    "Business Model Innovation",
  ],
  selectionRationale:
    "Content creator persona dominates; Greg Isenberg's channel focuses on startup ideas and business building, attracting entrepreneurs seeking actionable intelligence on emerging tools.",
};

const REAL_NODE_SHAPE = {
  id: "jev_model",
  type: "tool",
  label: "Jev",
  weight: 10,
  keyTerms: ["classifier", "decision-maker", "fast", "cheap"],
  polarity: 1,
  dimension: 8,
  entityType: "tool",
};

const REAL_EDGE_SHAPE = {
  kind: "related",
  source: "jev_model",
  target: "classifier_ai",
  strength: 10,
  rationale:
    "Jev is architecturally defined as a classifier; this is the foundational identity.",
};

describe("persona fragment accepts tier2A/tier2B (2026-09-25 regression)", () => {
  it("accepts the real chunk-1 persona config verbatim", () => {
    const result = validateFragment({ type: "persona", config: REAL_PERSONA_WITH_TIER2 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("persona");
  });

  it("canonicalizes lowercase/underscored tier2 key variants", () => {
    for (const variant of ["tier2a", "tier2_a", "tier2b", "tier2_b"]) {
      const config = {
        ...REAL_PERSONA_WITH_TIER2,
        [variant]: REAL_PERSONA_WITH_TIER2.tier2A,
      };
      delete (config as Record<string, unknown>).tier2A;
      const result = validateFragment({ type: "persona", config });
      expect(result.success).toBe(true);
    }
  });

  it("payload schema accepts persona with tier2 slots", () => {
    const payload = {
      schemaVersion: "2.0",
      persona: REAL_PERSONA_WITH_TIER2,
      dimensions: [
        {
          number: 1,
          name: "Apex Intelligence",
          content: "A content body of at least ten characters.",
        },
      ],
      knowledgeGraph: { nodes: [], edges: [], rootId: null },
      classification: {
        authoritative: true,
        practicallyActionable: true,
        knowledgeGraphReady: true,
        safe: true,
        personaOptimised: true,
        recommendation: "recommended",
      },
    };
    expect(UCISPayloadV2Schema.safeParse(payload).success).toBe(true);
  });
});

describe("kg fragment accepts real node/edge shapes (2026-09-25 regression)", () => {
  it("accepts a node carrying only the `type` alias", () => {
    const node = { ...REAL_NODE_SHAPE };
    delete (node as Record<string, unknown>).entityType;
    const result = KGNodeSchema.safeParse(node);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.entityType).toBe("tool");
  });

  it("accepts a node with both type and entityType, no content", () => {
    const result = KGNodeSchema.safeParse(REAL_NODE_SHAPE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.content).toBeUndefined();
  });

  it("accepts the real chunk-2 kg fragment with 20 edges (old cap was 18)", () => {
    expect(MAX_KG_EDGES).toBeGreaterThanOrEqual(20);
    const fragment = {
      type: "kg",
      nodes: Array.from({ length: 15 }, (_item, i) => ({
        ...REAL_NODE_SHAPE,
        id: `node_${i}`,
      })),
      edges: Array.from({ length: 20 }, (_item, i) => ({
        ...REAL_EDGE_SHAPE,
        source: `node_${i % 15}`,
        target: `node_${(i + 1) % 15}`,
      })),
      rootId: "jev_model",
    };
    const result = validateFragment(fragment);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "kg") {
      expect(result.data.edges).toHaveLength(20);
    }
  });

  it("still rejects a node with an unknown entityType", () => {
    const result = KGNodeSchema.safeParse({
      ...REAL_NODE_SHAPE,
      entityType: "widget",
      type: undefined,
    });
    expect(result.success).toBe(false);
  });
});
