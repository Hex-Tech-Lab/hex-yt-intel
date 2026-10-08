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
});
