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
  KGEdgeSchema,
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

  it("accepts the real chunk-2 kg fragment, slicing 20 edges to the 18-edge standard (user directive 2026-09-28)", () => {
    expect(MAX_KG_EDGES).toBe(18);
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
      expect(result.data.edges).toHaveLength(18);
    }
  });

  it("coerces a node with an unknown entityType to 'concept' (2026-09-27 tolerance contract)", () => {
    // Was: rejected outright (which dropped the WHOLE kg fragment on live
    // production video 39hqY3nH5ug). Now degrades to the generic bucket.
    const result = KGNodeSchema.safeParse({
      ...REAL_NODE_SHAPE,
      entityType: "widget",
      type: undefined,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.entityType).toBe("concept");
  });
});

describe("kg fragment tolerant normalization (2026-09-27 regression, 39hqY3nH5ug)", () => {
  // RCA: a 3-hour geopolitical/theological video legitimately yields node
  // entityTypes outside the fixed enum; ONE unmatched value used to reject
  // the WHOLE kg fragment client-side ("[Synthesis] Fragment validation
  // failed"), silently erasing the knowledge graph. Contract: never reject,
  // always degrade.

  it("coerces unknown entityType to 'concept' instead of rejecting the fragment", () => {
    const result = validateFragment({
      type: "kg",
      nodes: [
        { id: "eschatology", dimension: 8, label: "Eschatology", weight: 7, polarity: 0, keyTerms: ["end times"], entityType: "religion" },
      ],
      edges: [],
      rootId: "eschatology",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes[0].entityType).toBe("concept");
    }
  });

  it("clamps out-of-range weight/polarity/strength and unknown edge kind", () => {
    const node = KGNodeSchema.parse({ id: "x", dimension: 8, label: "X", weight: 42, polarity: 9, keyTerms: [], entityType: "concept" });
    expect(node.weight).toBe(10);
    expect(node.polarity).toBe(1);
    const edge = KGEdgeSchema.parse({ source: "a", target: "b", strength: 99, kind: "supports" });
    expect(edge.strength).toBe(10);
    expect(edge.kind).toBe("related");
  });

  it("slices nodes/edges over cap instead of rejecting the whole graph", () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, dimension: 8, label: `N${i}`, weight: 5, polarity: 0, keyTerms: [], entityType: "concept" }));
    const edges = Array.from({ length: 30 }, (_, i) => ({ source: `n${i}`, target: `n${(i + 1) % 30}`, strength: 5, kind: "related" }));
    const result = validateFragment({ type: "kg", nodes, edges, rootId: "n0" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes.length).toBe(24);
      expect(result.data.edges.length).toBe(MAX_KG_EDGES);
    }
  });

  it("drops structurally unusable nodes/edges, keeps the rest", () => {
    const result = validateFragment({
      type: "kg",
      nodes: [
        { id: "ok", dimension: 8, label: "OK", weight: 5, polarity: 0, keyTerms: [], entityType: "concept" },
        null,
        { dimension: 8, label: "No id", weight: 5, polarity: 0, keyTerms: [], entityType: "concept" },
      ],
      edges: [
        { source: "ok", target: "ok", strength: 5, kind: "related" },
        { target: "ok", strength: 5, kind: "related" }, // no source
      ],
      rootId: "ok",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes.length).toBe(1);
      expect(result.data.edges.length).toBe(1);
    }
  });

  it("normalizes node type/entityType key duality still (original 2026-09-25 regression)", () => {
    const node = KGNodeSchema.parse({ id: "n", dimension: 8, label: "N", weight: 5, polarity: 0, keyTerms: [], type: "person" });
    expect(node.entityType).toBe("person");
  });

  it("clamps out-of-range node dimension", () => {
    const node = KGNodeSchema.parse({ id: "n", dimension: 99, label: "N", weight: 5, polarity: 0, keyTerms: [], entityType: "concept" });
    expect(node.dimension).toBe(11);
  });
});
