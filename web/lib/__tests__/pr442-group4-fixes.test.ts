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

  it("keeps distinct non-Latin bodies instead of normalizing them to the empty string", () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, "#### 1.1 T\nالنمو كان قويا في الربع الأول"),
      mk(1, "#### 1.1 T\nانخفضت الأرباح بشكل حاد في الربع الثاني"),
    ]);
    expect(out[0].content).toContain("النمو");
    expect(out[0].content).toContain("انخفضت");
  });

  it("treats round-minute timestamps like [10:00] as real, not placeholders", () => {
    const out = CombinerPass.reduceDimensions([
      mk(5, "#### 5.1 M\n1. **Key point about growth** [timestamp not provided in transcript]"),
      mk(5, "#### 5.1 M\n1. **Key point about growth** [10:00]"),
    ]);
    expect(out[0].content).toContain("[10:00]");
    expect(out[0].content).not.toContain("timestamp not provided");
  });

  it("does not merge amounts that differ only by currency symbol, and keeps symbol-only blocks", () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, "#### 1.1 T\nRaised \u20ac5 million in funding\n\n\u2605\u2605\u2605"),
      mk(1, "#### 1.1 T\nRaised $5 million in funding"),
    ]);
    expect(out[0].content).toContain("\u20ac5 million");
    expect(out[0].content).toContain("$5 million");
    expect(out[0].content).toContain("\u2605\u2605\u2605");
  });
});

describe('CombinerPass header scope and single-chunk passthrough (T1 review)', () => {
  it('treats another dimension\'s X.Y line as body text, not a header', () => {
    const md = '#### 4.1 Claims\n\n1.5 - growth stated by host\n\n#### 4.2 Evidence\n\nBody';
    const ast = CombinerPass.parseDimensionMarkdown(4, 'D4', md);
    expect([...ast.subsections.keys()]).toEqual(['4.1', '4.2']);
    expect(ast.subsections.get('4.1')?.body).toContain('1.5 - growth stated by host');
  });

  it('keeps a single chunk byte-for-byte when no sub-section repeats', () => {
    const content = '### 4.2 Evidence\n\nB\n\n### 4.1 Claims\n\nA';
    const out = CombinerPass.combineDimensionChunks(4, [{ number: 4, name: 'D4', content }]);
    expect(out.content).toBe(content);
  });
});

describe('CombinerPass bounded logic & dedupe fixes (Tasks 1, 2, 3, 5)', () => {
  const mk = (number: number, content: string) => ({ number, content });

  it('does not drop $5 as a duplicate of $50 (strict token/word boundaries)', () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Finance\nBudget $5'),
      mk(1, '#### 1.1 Finance\nBudget $50'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toMatch(/Budget \$5(?!\d)/);
    expect(out[0].content).toMatch(/Budget \$50(?!\d)/);
  });

  it('does not drop 15000 as a duplicate of 150000 (strict token/word boundaries)', () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Metrics\nActive subscribers 15000'),
      mk(1, '#### 1.1 Metrics\nActive subscribers 150000'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toMatch(/subscribers 15000(?!\d)/);
    expect(out[0].content).toMatch(/subscribers 150000(?!\d)/);
  });

  it('keeps symbol-only strings like ☆☆☆☆☆ and ★★★★★ distinct', () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Rating\n☆☆☆☆☆\n\nContent A'),
      mk(1, '#### 1.1 Rating\n★★★★★\n\nContent B'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('☆☆☆☆☆');
    expect(out[0].content).toContain('★★★★★');
  });

  it('deduplicates identical symbol-only blocks', () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Rating\n☆☆☆☆☆\n\nDetails'),
      mk(1, '#### 1.1 Rating\n☆☆☆☆☆\n\nMore details'),
    ]);
    expect(out).toHaveLength(1);
    const starMatches = out[0].content.match(/☆☆☆☆☆/g);
    expect(starMatches).toHaveLength(1);
  });

  it('keeps decimal separators distinct between comma and period (3,14 vs 3.14)', () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Math\nCalculated coefficient was 3.14 exactly.'),
      mk(1, '#### 1.1 Math\nCalculated coefficient was 3,14 exactly.'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('3.14');
    expect(out[0].content).toContain('3,14');
  });

  it('upgrades placeholder timestamps to real timestamps and never downgrades real to placeholder', () => {
    // 1. Upgrade placeholder -> real
    const upgraded = CombinerPass.reduceDimensions([
      mk(5, '#### 5.1 Insights\nBreakthrough model [timestamp not provided in transcript]'),
      mk(5, '#### 5.1 Insights\nBreakthrough model [04:15]'),
    ]);
    expect(upgraded[0].content).toContain('[04:15]');
    expect(upgraded[0].content).not.toContain('timestamp not provided');

    // 2. Real timestamp is never overwritten by longer placeholder
    const preserved = CombinerPass.reduceDimensions([
      mk(5, '#### 5.1 Insights\nBreakthrough model [04:15]'),
      mk(5, '#### 5.1 Insights\nBreakthrough model [0:00 approximate transcript carries no explicit timestamps]'),
    ]);
    expect(preserved[0].content).toContain('[04:15]');
    expect(preserved[0].content).not.toContain('carries no explicit timestamps');
  });

  it('keeps distinct subsections sorted in ascending numerical order across chunks', () => {
    const out = CombinerPass.reduceDimensions([
      mk(2, '#### 2.3 Section Three\nBody 3\n\n#### 2.1 Section One\nBody 1'),
      mk(2, '#### 2.4 Section Four\nBody 4\n\n#### 2.2 Section Two\nBody 2'),
    ]);
    expect(out).toHaveLength(1);
    const content = out[0].content;
    const idx1 = content.indexOf('2.1 Section One');
    const idx2 = content.indexOf('2.2 Section Two');
    const idx3 = content.indexOf('2.3 Section Three');
    const idx4 = content.indexOf('2.4 Section Four');

    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
    expect(idx4).toBeGreaterThan(idx3);
  });

  it('recognizes both bold and plain headers as valid subheaders', () => {
    const boldAst = CombinerPass.parseDimensionMarkdown(4, 'D4', '**4.1 Bold Header**\nBody text');
    expect(boldAst.subsections.has('4.1')).toBe(true);
    expect(boldAst.subsections.get('4.1')?.title).toBe('Bold Header');

    const plainAst = CombinerPass.parseDimensionMarkdown(4, 'D4', '4.1 - Plain Header\nBody text');
    expect(plainAst.subsections.has('4.1')).toBe(true);
    expect(plainAst.subsections.get('4.1')?.title).toBe('Plain Header');
  });

  it('normalizes Dimension 7 system blocks across chunks', () => {
    const out = CombinerPass.reduceDimensions([
      mk(7, 'Intro text\n\n**System: Primary Architecture**\nBody for system 1'),
      mk(7, '#### 7.2 Secondary Systems\nBody for system 2'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('**System 1: Primary Architecture**');
  });
});

