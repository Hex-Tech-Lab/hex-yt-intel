import { describe, expect, it } from "vitest";
import { ExtractedClaimSchema, GroundedExtractionPayloadSchema } from "@/lib/types/contracts";
import { CombinerPass } from "@/lib/services/CombinerPass";

const baseClaim = {
  id: "c1",
  verbatimQuote: "quote",
  atomicAssertion: "assertion",
  confidence: 0.9,
};

describe("ExtractedClaimSchema", () => {
  it("accepts a normal claim", () => {
    expect(
      ExtractedClaimSchema.safeParse({ ...baseClaim, timestampRange: [10, 25] }).success
    ).toBe(true);
  });

  it("rejects a reversed timestamp range", () => {
    expect(
      ExtractedClaimSchema.safeParse({ ...baseClaim, timestampRange: [25, 10] }).success
    ).toBe(false);
  });
});

describe("GroundedExtractionPayloadSchema", () => {
  const payload = (ids: string[]) => ({
    claims: ids.map((id) => ({ ...baseClaim, id, timestampRange: [0, 5] })),
    unknowns: [],
    metadata: { speakerCount: 1, durationSeconds: 10, classification: "S2" },
  });

  it("accepts unique claim IDs", () => {
    expect(GroundedExtractionPayloadSchema.safeParse(payload(["a", "b"])).success).toBe(true);
  });

  it("rejects duplicate claim IDs", () => {
    expect(GroundedExtractionPayloadSchema.safeParse(payload(["a", "a"])).success).toBe(false);
  });
});

describe("CombinerPass.normalizeDimension7", () => {
  it("does not split prose that merely begins with 'System'", () => {
    const out = CombinerPass.normalizeDimension7("System design matters because risks compound.");
    expect(out).not.toContain("**System 1:");
  });

  it("splits unnumbered 'System:' blocks", () => {
    const out = CombinerPass.normalizeDimension7("Intro\n**System: Alpha**\nBody text here.");
    expect(out).toContain("**System 1:");
  });

  it("strips brackets from titles cleanly", () => {
    const out = CombinerPass.normalizeDimension7("**System: [Alpha]**\nBody.");
    expect(out).toContain("**System 1: Alpha**");
    expect(out).not.toContain("Alpha]");
  });
});

describe("CombinerPass.reduceDimensions", () => {
  const mk = (number: number, content: string) => ({ number, content });

  it("does not duplicate overlapping bodies", () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, "#### 1.1 Overview\nShared body"),
      mk(1, "#### 1.1 Overview\nShared body"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content.match(/Shared body/g)).toHaveLength(1);
  });

  it("keeps distinct bodies that merely overlap textually", () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, "#### 1.1 Overview\nShort"),
      mk(1, "#### 1.1 Overview\nShort but different"),
    ]);
    expect(out[0].content).toContain("Short but different");
  });

  it("keeps the extra detail when an incoming block is a superset of an existing block", () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, "#### 1.1 Overview\nAlpha launch happened in March with strong adoption across all segments\n\nBeta program expanded to twelve customers."),
      mk(1, "#### 1.1 Overview\nAlpha launch happened in March with strong adoption across all segments by June"),
    ]);
    expect(out[0].content).toContain("by June");
    expect(out[0].content).toContain("Beta program expanded");
  });

  it("does not collapse facts that differ only by sign", () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, "#### 1.1 Overview\nChurn fell -5% in Q2."),
      mk(1, "#### 1.1 Overview\nChurn fell 5% in Q2."),
    ]);
    expect(out[0].content).toContain("-5%");
    expect(out[0].content).toContain("Churn fell 5% in Q2");
  });

  it("deduplicates multi-section Dimensions (e.g. 2.1 to 2.4) across multiple chunks", () => {
    const chunk1 = [
      "#### 2.1 Header Intelligence",
      "| Field | Value |",
      "| Title | Advanced Personal Language Models |",
      "",
      "#### 2.2 Engagement & Virality Metrics",
      "| Views | 15000 |",
      "",
      "#### 2.3 Channel Authority Assessment",
      "High credibility established in 2.1.",
      "",
      "#### 2.4 Audience Sentiment Prediction",
      "Highly positive reception.",
    ].join("\n");

    const chunk2 = [
      "#### 2.1 Header Intelligence",
      "| Field | Value |",
      "| Title | Advanced Personal Language Models |",
      "",
      "#### 2.2 Engagement & Virality Metrics",
      "| Views | 15000 |",
      "",
      "#### 2.3 Channel Authority Assessment",
      "High credibility established in 2.1.",
      "",
      "#### 2.4 Audience Sentiment Prediction",
      "Highly positive reception.",
    ].join("\n");

    const out = CombinerPass.reduceDimensions([mk(2, chunk1), mk(2, chunk2)]);
    expect(out).toHaveLength(1);
    expect(out[0].content.match(/#### 2\.1 Header Intelligence/g)).toHaveLength(1);
    expect(out[0].content.match(/#### 2\.2 Engagement & Virality Metrics/g)).toHaveLength(1);
    expect(out[0].content.match(/#### 2\.3 Channel Authority Assessment/g)).toHaveLength(1);
    expect(out[0].content.match(/#### 2\.4 Audience Sentiment Prediction/g)).toHaveLength(1);
    expect(out[0].content.match(/Advanced Personal Language Models/g)).toHaveLength(1);
  });

  it("deduplicates internal section repetition within a single chunk", () => {
    const singleChunkWithDupes = [
      "#### 3.1 Executive Overview",
      "Core thesis narrative.",
      "",
      "#### 3.2 First Principles Deconstruction",
      "- Foundational axiom.",
      "",
      "#### 3.1 Executive Overview",
      "Core thesis narrative.",
      "",
      "#### 3.2 First Principles Deconstruction",
      "- Foundational axiom.",
    ].join("\n");

    const out = CombinerPass.reduceDimensions([mk(3, singleChunkWithDupes)]);
    expect(out).toHaveLength(1);
    expect(out[0].content.match(/#### 3\.1 Executive Overview/g)).toHaveLength(1);
    expect(out[0].content.match(/#### 3\.2 First Principles Deconstruction/g)).toHaveLength(1);
    expect(out[0].content.match(/Core thesis narrative/g)).toHaveLength(1);
  });

  it("deduplicates Dimension 5 insights when one has 'timestamp not provided' and the other has '[00:00] (approximate)'", () => {
    const chunkA = [
      "#### 5.1 Priority Insights Matrix",
      "**Tier 1 – Breakthrough Insights**:",
      "1. **Writing as a repeatable personal language model** [timestamp not provided in transcript]",
      "   - Detailed explanation with context.",
      "2. **Originally comes from crystallized thinker** [timestamp not provided in transcript]",
      "   - Thinking precedes writing.",
    ].join("\n");

    const chunkB = [
      "#### 5.1 Priority Insights Matrix",
      "**Tier 1 – Breakthrough Insights**:",
      "1. **Writing as a repeatable personal language model** [00:00] (approximate; transcript carries no explicit timestamps)",
      "   - Detailed explanation with context.",
      "2. **Originally comes from crystallized thinker** [00:00] (approximate)",
      "   - Thinking precedes writing.",
    ].join("\n");

    const out = CombinerPass.reduceDimensions([mk(5, chunkA), mk(5, chunkB)]);
    expect(out).toHaveLength(1);
    expect(out[0].content.match(/Writing as a repeatable personal language model/g)).toHaveLength(1);
    expect(out[0].content.match(/Originally comes from crystallized thinker/g)).toHaveLength(1);
  });

  it("upgrades placeholder timestamps to real non-zero timestamps without duplicating the items", () => {
    const chunkUnanchored = [
      "#### 5.1 Priority Insights Matrix",
      "**Tier 1 – Breakthrough Insights**:",
      "1. **Writing as a repeatable personal language model** [timestamp not provided in transcript]",
      "   - Detailed explanation with context.",
    ].join("\n");

    const chunkAnchored = [
      "#### 5.1 Priority Insights Matrix",
      "**Tier 1 – Breakthrough Insights**:",
      "1. **Writing as a repeatable personal language model** [04:15]",
      "   - Detailed explanation with context.",
    ].join("\n");

    const out = CombinerPass.reduceDimensions([mk(5, chunkUnanchored), mk(5, chunkAnchored)]);
    expect(out).toHaveLength(1);
    expect(out[0].content.match(/Writing as a repeatable personal language model/g)).toHaveLength(1);
    expect(out[0].content).toContain("[04:15]");
    expect(out[0].content).not.toContain("timestamp not provided");
  });
});
