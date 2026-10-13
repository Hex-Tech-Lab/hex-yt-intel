/**
 * PR #501 review: CombinerPass section merge as seen through reduceGroundedChunks.
 */
import { describe, expect, it } from "vitest";

import { reduceGroundedChunks } from "@/lib/services/reduce-grounded-chunks";
import type { GroundedCell } from "@/lib/services/reduce-grounded-chunks";
import type { UCISDimension } from "@/lib/types/dimension";

function makeDimension(overrides: Partial<UCISDimension> & { number: number }): UCISDimension {
  return { name: `Dimension ${overrides.number}`, content: "", ...overrides };
}

function reduce2(cells: readonly GroundedCell[], expectedJevChunkCount: number) {
  return reduceGroundedChunks(cells, { expectedJevChunkCount });
}

describe("reduceGroundedChunks — CombinerPass section merge (PR #501 review)", () => {
  const cell = (jevChunkIndex: number, dimensions: UCISDimension[]): GroundedCell => ({
    jevChunkIndex,
    wordCount: 10,
    dimensions,
  });

  it("keeps distinct sections, ordered by jevChunkIndex not input order", () => {
    const result = reduce2(
      [
        cell(1, [makeDimension({ number: 2, content: "#### 2.2 Second\nB body" })]),
        cell(0, [makeDimension({ number: 2, content: "#### 2.1 First\nA body" })]),
      ],
      2,
    );
    const content = result.dimensions[0]!.content;
    expect(content).toContain("A body");
    expect(content).toContain("B body");
    expect(content.indexOf("2.1 First")).toBeLessThan(content.indexOf("2.2 Second"));
  });

  it("dedupes repeated Dimension 7 System blocks and labels subsections", () => {
    const body = "**System 1: Alpha**\n\nStep-by-Step Implementation\nDo it";
    const result = reduce2(
      [
        cell(0, [makeDimension({ number: 7, content: body })]),
        cell(1, [makeDimension({ number: 7, content: body })]),
      ],
      2,
    );
    const content = result.dimensions[0]!.content;
    expect(content.match(/System 1: Alpha/g)).toHaveLength(1);
    expect(content).toContain("A. Step-by-Step Implementation");
  });

  it("merges '**2.1 Title**' and '2.1 - Title' headers into one section", () => {
    const result = reduce2(
      [
        cell(0, [makeDimension({ number: 2, content: "**2.1 Title**\nAlpha fact" })]),
        cell(1, [makeDimension({ number: 2, content: "2.1 - Title\nBeta fact" })]),
      ],
      2,
    );
    const content = result.dimensions[0]!.content;
    expect(content.match(/2\.1 Title/g)).toHaveLength(1);
    expect(content).toContain("Alpha fact");
    expect(content).toContain("Beta fact");
  });

  it("treats an own-dimension '4.1 - growth' line as a header, not body", () => {
    const result = reduce2(
      [
        cell(0, [makeDimension({ number: 4, content: "#### 4.2 Evidence\nBody" })]),
        cell(1, [makeDimension({ number: 4, content: "4.1 - growth\nGrowth detail" })]),
      ],
      2,
    );
    const content = result.dimensions[0]!.content;
    expect(content).toContain("#### 4.1 growth");
    expect(content.indexOf("4.1 growth")).toBeLessThan(content.indexOf("4.2 Evidence"));
  });

  it("15000 vs 150000 and $5 vs $50 survive in both orders", () => {
    for (const [first, second] of [["$5", "$50"], ["$50", "$5"], ["15000", "150000"], ["150000", "15000"]] as const) {
      const result = reduce2(
        [
          cell(0, [makeDimension({ number: 1, content: `#### 1.1 T\nValue ${first}` })]),
          cell(1, [makeDimension({ number: 1, content: `#### 1.1 T\nValue ${second}` })]),
        ],
        2,
      );
      const content = result.dimensions[0]!.content;
      const has = (v: string) => content.split(/\s+/).includes(v);
      expect(has(first)).toBe(true);
      expect(has(second)).toBe(true);
    }
  });

  it("negative control: equal values collapse to a single occurrence", () => {
    const result = reduce2(
      [
        cell(0, [makeDimension({ number: 1, content: "#### 1.1 T\nValue $50" })]),
        cell(1, [makeDimension({ number: 1, content: "#### 1.1 T\nValue $50" })]),
      ],
      2,
    );
    expect(result.dimensions[0]!.content.match(/\$50/g)).toHaveLength(1);
  });
});
