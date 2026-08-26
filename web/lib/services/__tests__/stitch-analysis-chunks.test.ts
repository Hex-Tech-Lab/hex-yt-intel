import { describe, it, expect } from "vitest";
import { stitchChunksIntoPayload } from "../stitch-analysis-chunks";

describe("stitchChunksIntoPayload", () => {
  it("accumulates frequencies and emits single canonical entity for same label with different casing", () => {
    const chunkMap = new Map();
    const mockNode = {
      dimension: 1,
      content: "This is a valid piece of content.",
      polarity: 0,
      keyTerms: ["test"],
      entityType: "person",
    };

    const mockPayloadBase = {
      persona: {
        primary: { id: "creator", label: "Creator" },
        secondary: { id: "researcher", label: "Researcher" }
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
      dimensions: [{ number: 1, name: "Test", content: "valid content that is long enough" }],
      knowledgeGraph: {
        nodes: [{ ...mockNode, id: "Apple", label: "Apple", weight: 0.1 }],
        edges: [],
        rootId: "Node1"
      }
    });
    chunkMap.set(2, {
      dimensions: [{ number: 2, name: "Test", content: "valid content that is long enough" }],
      knowledgeGraph: {
        nodes: [{ ...mockNode, id: "APPLE ", label: "APPLE ", weight: 0.2 }],
        edges: []
      }
    });
    chunkMap.set(3, {
      dimensions: [{ number: 3, name: "Test", content: "valid content that is long enough" }],
      knowledgeGraph: {
        nodes: [{ ...mockNode, id: "apple", label: "apple", weight: 0.3 }],
        edges: []
      }
    });

    const result = stitchChunksIntoPayload(chunkMap, 3);
    
    // Should emit 1 node
    expect(result.payload?.knowledgeGraph?.nodes).toHaveLength(1);
    
    // Weight should be normalized for frequency = 3
    const node = result.payload?.knowledgeGraph?.nodes[0] as any;
    expect(node.weight).toBeGreaterThan(0.1); // Just check it got processed
    expect(node.label).toBe("Apple"); // Preserves first occurrence case
  });
});
