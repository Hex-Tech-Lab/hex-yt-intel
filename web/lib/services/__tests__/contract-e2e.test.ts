import { describe, it, expect } from "vitest";
import { stitchChunksIntoPayload } from "../stitch-analysis-chunks";

describe("Contract Boundaries E2E", () => {
  it("processes LLM chunks with mixed-casing and POLE+O permutations", () => {
    const chunkMap = new Map();

    const mockPayloadBase = {
      persona: {
        primary: { id: "content_creator", label: "Creator", weight: 0.8 },
        secondary: { id: "indie_maker", label: "Researcher", weight: 0.2 },
        cognitiveLenses: ["Lens 1"],
        selectionRationale: "This is a reasonable rationale."
      },
      classification: {
        authoritative: true,
        practicallyActionable: true,
        knowledgeGraphReady: true,
        safe: true,
        personaOptimised: true,
        recommendation: "highly_recommended"
      }
    };

    chunkMap.set(1, {
      ...mockPayloadBase,
      schemaVersion: "2.0",
      dimensions: [{ number: 1, name: "Test", content: "valid content that is long enough" }],
      knowledgeGraph: {
        nodes: [{ id: "Node1", label: "TestNode", entityType: "Person", content: "test content that is long enough", keyTerms: ["one"], weight: 1, dimension: 1, polarity: 0 }],
        edges: [],
        rootId: "Node1"
      }
    });

    const result = stitchChunksIntoPayload(chunkMap, 1);
    
    // We expect the schema fallback to accept content_creator -> creator
    expect(result.payload?.persona.primary.id).toBe("creator");
    expect(result.payload?.persona.secondary?.id).toBe("indieMaker");
    
    // We expect the node entityType 'Person' to pass schema validation successfully
    expect(result.payload?.knowledgeGraph?.nodes).toHaveLength(1);
    const node = result.payload?.knowledgeGraph?.nodes[0] as any;
    expect(node.entityType).toBe("Person");
  });
});
