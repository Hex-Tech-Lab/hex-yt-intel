/**
 * ADR 037 Addendum A5 reduce tests: exact-value per rule + seeded-PRNG
 * property tests (mulberry32, inlined). Every behavioural rule has a
 * negative control in the accompanying contract test blocks.
 */
import { describe, expect, it } from "vitest";

import { reduceGroundedChunks } from "@/lib/services/reduce-grounded-chunks";
import type { GroundedCell } from "@/lib/services/reduce-grounded-chunks";
import type { UCISDimension } from "@/lib/types/dimension";

/** Seeded PRNG (mulberry32) — deterministic, no Math.random anywhere. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function nextRandom(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDimension(overrides: Partial<UCISDimension> & { number: number }): UCISDimension {
  return {
    name: `Dimension ${overrides.number}`,
    content: `Content for dimension ${overrides.number}`,
    ...overrides,
  };
}

function shuffledCopy(cells: readonly GroundedCell[], seed: number): GroundedCell[] {
  const random = mulberry32(seed);
  const copy = [...cells];
  for (let targetIndex = copy.length - 1; targetIndex > 0; targetIndex--) {
    const swapIndex = Math.floor(random() * (targetIndex + 1));
    const held = copy[targetIndex]!;
    copy[targetIndex] = copy[swapIndex]!;
    copy[swapIndex] = held;
  }
  return copy;
}

function reduce2(cells: readonly GroundedCell[], expectedJevChunkCount: number) {
  return reduceGroundedChunks(cells, { expectedJevChunkCount });
}

describe("reduceGroundedChunks — input validation (A5 hardening)", () => {
  it("throws when expectedJevChunkCount is missing", () => {
    expect(() => {
      // @ts-expect-error — deliberately omitting the required option.
      reduceGroundedChunks([]);
    }).toThrow(/expectedJevChunkCount/);
  });

  it("throws when expectedJevChunkCount is zero, negative, or non-integer (negative controls)", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null]) {
      expect(() => reduce2([], bad as number)).toThrow(/expectedJevChunkCount/);
    }
  });

  it("throws when a jevChunkIndex is out of range [0, expected)", () => {
    const cells: GroundedCell[] = [
      { jevChunkIndex: 0, wordCount: 100, dimensions: [makeDimension({ number: 1 })] },
      { jevChunkIndex: 3, wordCount: 100, dimensions: [makeDimension({ number: 1 })] },
    ];
    expect(() => reduce2(cells, 3)).toThrow(/jevChunkIndex/);
  });

  it("throws when a jevChunkIndex is not a safe integer (negative controls)", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        reduce2([{ jevChunkIndex: bad as number, wordCount: 1, dimensions: [] }], 3),
      ).toThrow(/jevChunkIndex/);
    }
  });

  it("throws on duplicate jevChunkIndex across cells", () => {
    const cells: GroundedCell[] = [
      { jevChunkIndex: 0, wordCount: 100, dimensions: [makeDimension({ number: 1 })] },
      { jevChunkIndex: 0, wordCount: 100, dimensions: [makeDimension({ number: 2 })] },
    ];
    expect(() => reduce2(cells, 2)).toThrow(/duplicate jevChunkIndex 0/);
  });

  it("throws when one cell has two dimensions with the same number", () => {
    const cells: GroundedCell[] = [
      {
        jevChunkIndex: 0,
        wordCount: 100,
        dimensions: [makeDimension({ number: 1 }), makeDimension({ number: 1 })],
      },
    ];
    expect(() => reduce2(cells, 1)).toThrow(/duplicate dimension number 1/);
  });

  it("boundary index expected-1 is valid (no false rejection)", () => {
    const cells: GroundedCell[] = [
      { jevChunkIndex: 2, wordCount: 100, dimensions: [makeDimension({ number: 1 })] },
    ];
    const result = reduce2(cells, 3);
    expect(result.dimensions.map((dimension) => dimension.number)).toEqual([1]);
  });
});

describe("reduceGroundedChunks — expected-chunk completeness (partial)", () => {
  it("gap [0,2] of 3 → every dimension present is partial (chunk 1 has no cell)", () => {
    const cells: GroundedCell[] = [
      { jevChunkIndex: 0, wordCount: 100, dimensions: [makeDimension({ number: 1 }), makeDimension({ number: 2 })] },
      { jevChunkIndex: 2, wordCount: 100, dimensions: [makeDimension({ number: 1 })] },
    ];
    const result = reduce2(cells, 3);
    // Both dims miss chunk 1 (which has no cell at all); dim 2 also misses chunk 2.
    expect(result.partial).toEqual([1, 2]);
    expect(result.dimensions.map((dimension) => dimension.number)).toEqual([1, 2]);
  });

  it("every expected chunk covered → no partial entries (negative control)", () => {
    const cells: GroundedCell[] = [
      { jevChunkIndex: 0, wordCount: 100, dimensions: [makeDimension({ number: 1 })] },
      { jevChunkIndex: 1, wordCount: 100, dimensions: [makeDimension({ number: 1 })] },
      { jevChunkIndex: 2, wordCount: 100, dimensions: [makeDimension({ number: 1 })] },
    ];
    expect(reduce2(cells, 3).partial).toEqual([]);
  });
});

describe("reduceGroundedChunks — exact rules (A5)", () => {
  it("orders by jevChunkIndex ascending, never input order (content join order)", () => {
    const result = reduce2(
      [
        { jevChunkIndex: 2, wordCount: 100, dimensions: [makeDimension({ number: 1, content: "SECOND" })] },
        { jevChunkIndex: 0, wordCount: 50, dimensions: [makeDimension({ number: 1, content: "FIRST" })] },
        { jevChunkIndex: 1, wordCount: 70, dimensions: [makeDimension({ number: 1, content: "MIDDLE" })] },
      ],
      3,
    );
    expect(result.dimensions[0]!.content).toBe("FIRST\n\nMIDDLE\n\nSECOND");
  });

  it("concatenates and dedupes keyTerms by normalized key (case/whitespace), keeping first", () => {
    const result = reduce2(
      [
        {
          jevChunkIndex: 0,
          wordCount: 100,
          dimensions: [makeDimension({ number: 1, metadata: { keyTerms: ["Compound  Interest", "Alpha"] } })],
        },
        {
          jevChunkIndex: 1,
          wordCount: 100,
          dimensions: [makeDimension({ number: 1, metadata: { keyTerms: ["compound interest", "Beta"] } })],
        },
      ],
      2,
    );
    const metadata = result.dimensions[0]!.metadata!;
    expect(metadata.keyTerms).toEqual(["Compound  Interest", "Alpha", "Beta"]);
  });

  it("joins prose content with one blank line, no rewriting", () => {
    const result = reduce2(
      [
        { jevChunkIndex: 0, wordCount: 10, dimensions: [makeDimension({ number: 3, content: "Part one." })] },
        { jevChunkIndex: 1, wordCount: 20, dimensions: [makeDimension({ number: 3, content: "Part two." })] },
      ],
      2,
    );
    expect(result.dimensions[0]!.content).toBe("Part one.\n\nPart two.");
  });

  it("computes wordCount-weighted mean confidence over chunks that have the dimension", () => {
    const result = reduce2(
      [
        { jevChunkIndex: 0, wordCount: 300, dimensions: [makeDimension({ number: 5, metadata: { confidence: 0.8 } })] },
        { jevChunkIndex: 1, wordCount: 100, dimensions: [makeDimension({ number: 5, metadata: { confidence: 0.4 } })] },
      ],
      2,
    );
    // (0.8*300 + 0.4*100) / 400 = 0.7 — not the unweighted mean 0.6.
    expect(result.dimensions[0]!.metadata!.confidence).toBe(0.7);
  });

  it("weights only chunks that HAVE the dimension (absent chunk contributes no weight)", () => {
    const result = reduce2(
      [
        { jevChunkIndex: 0, wordCount: 300, dimensions: [makeDimension({ number: 5, metadata: { confidence: 0.8 } })] },
        { jevChunkIndex: 1, wordCount: 100, dimensions: [] },
      ],
      2,
    );
    expect(result.dimensions[0]!.metadata!.confidence).toBe(0.8);
    expect(result.partial).toEqual([5]);
  });

  it("rounds the weighted mean to 4 decimals like the 0-1 source scale", () => {
    const result = reduce2(
      [
        { jevChunkIndex: 0, wordCount: 1, dimensions: [makeDimension({ number: 2, metadata: { confidence: 0.12345 } })] },
        { jevChunkIndex: 1, wordCount: 1, dimensions: [makeDimension({ number: 2, metadata: { confidence: 0.12346 } })] },
      ],
      2,
    );
    expect(result.dimensions[0]!.metadata!.confidence).toBe(0.1235);
  });

  it("zero total weight: plain mean over ONLY finite confidences (0.8 + missing → 0.8)", () => {
    const result = reduce2(
      [
        { jevChunkIndex: 0, wordCount: 0, dimensions: [makeDimension({ number: 2, metadata: { confidence: 0.8 } })] },
        { jevChunkIndex: 1, wordCount: 0, dimensions: [makeDimension({ number: 2 })] },
      ],
      2,
    );
    expect(result.dimensions[0]!.metadata!.confidence).toBe(0.8);
  });

  it("zero total weight with NO finite confidence → confidence key omitted entirely (never 0)", () => {
    const result = reduce2(
      [
        { jevChunkIndex: 0, wordCount: 0, dimensions: [makeDimension({ number: 2 })] },
        { jevChunkIndex: 1, wordCount: 0, dimensions: [makeDimension({ number: 2, metadata: { confidence: Number.NaN } })] },
      ],
      2,
    );
    const metadata = result.dimensions[0]!.metadata;
    if (metadata === undefined) return; // metadata omitted entirely — confidence certainly absent
    expect(metadata).not.toHaveProperty("confidence");
  });

  it("positive-weight path still ignores missing confidence values (negative control)", () => {
    const result = reduce2(
      [
        { jevChunkIndex: 0, wordCount: 100, dimensions: [makeDimension({ number: 2, metadata: { confidence: 0.8 } })] },
        { jevChunkIndex: 1, wordCount: 100, dimensions: [makeDimension({ number: 2 })] },
      ],
      2,
    );
    expect(result.dimensions[0]!.metadata!.confidence).toBe(0.8);
  });

  it("marks dimensions missing from some expected chunks in ascending partial; missing-in-all are absent", () => {
    const result = reduce2(
      [
        {
          jevChunkIndex: 0,
          wordCount: 100,
          dimensions: [makeDimension({ number: 1 }), makeDimension({ number: 4 })],
        },
        {
          jevChunkIndex: 1,
          wordCount: 100,
          dimensions: [makeDimension({ number: 4 })],
        },
      ],
      2,
    );
    // Dimension 1 missing from chunk 1 → partial. Dimension 4 in both → not partial.
    expect(result.partial).toEqual([1]);
    expect(result.dimensions.map((dimension) => dimension.number)).toEqual([1, 4]);
  });

  it("produces no partial entries when every expected chunk has every dimension", () => {
    const cells: GroundedCell[] = [
      { jevChunkIndex: 0, wordCount: 100, dimensions: [makeDimension({ number: 1 }), makeDimension({ number: 2 })] },
      { jevChunkIndex: 1, wordCount: 100, dimensions: [makeDimension({ number: 1 }), makeDimension({ number: 2 })] },
    ];
    expect(reduce2(cells, 2).partial).toEqual([]);
  });
});

describe("reduceGroundedChunks — K=1 passthrough", () => {
  it("expectedJevChunkCount 1 + one cell → dimensions returned unchanged (deep-equal, no rounding, no dedupe)", () => {
    const cell: GroundedCell = {
      jevChunkIndex: 0,
      wordCount: 500,
      dimensions: [
        makeDimension({
          number: 1,
          content: "Only chunk.",
          metadata: { keyTerms: ["A", "a", "A"], confidence: 0.123456 },
        }),
        makeDimension({ number: 2, content: "Second dim.", metadata: { confidence: 0.9 } }),
      ],
    };
    const result = reduceGroundedChunks([cell], { expectedJevChunkCount: 1 });
    expect(JSON.stringify(result.dimensions)).toBe(JSON.stringify(cell.dimensions));
    expect(result.dimensions[0]!.metadata!.confidence).toBe(0.123456);
    expect(result.dimensions[0]!.metadata!.keyTerms).toEqual(["A", "a", "A"]);
    expect(result.partial).toEqual([]);
  });

  it("K=1 returns the SAME object references (no copying/mutation)", () => {
    const cell: GroundedCell = {
      jevChunkIndex: 0,
      wordCount: 500,
      dimensions: [makeDimension({ number: 1, metadata: { confidence: 0.5 } })],
    };
    const result = reduceGroundedChunks([cell], { expectedJevChunkCount: 1 });
    expect(result.dimensions[0]).toBe(cell.dimensions[0]);
  });

  it("K=1 with a duplicate dimension number still throws (negative control)", () => {
    const cell: GroundedCell = {
      jevChunkIndex: 0,
      wordCount: 500,
      dimensions: [makeDimension({ number: 1 }), makeDimension({ number: 1 })],
    };
    expect(() => reduceGroundedChunks([cell], { expectedJevChunkCount: 1 })).toThrow(/duplicate dimension number/);
  });

  it("expectedJevChunkCount 1 with zero cells → empty result, not a passthrough", () => {
    const result = reduceGroundedChunks([], { expectedJevChunkCount: 1 });
    expect(result.dimensions).toEqual([]);
    expect(result.partial).toEqual([]);
  });
});

describe("reduceGroundedChunks — properties (seeded PRNG)", () => {
  const SEED = 0x5eed;
  const PROPERTY_CELL_COUNT = 7;
  const DIMENSION_POOL = [1, 2, 4, 7, 9];

  function buildRandomCells(seed: number): GroundedCell[] {
    const random = mulberry32(seed);
    const cells: GroundedCell[] = [];
    for (let cellIndex = 0; cellIndex < PROPERTY_CELL_COUNT; cellIndex++) {
      const dimensions: UCISDimension[] = DIMENSION_POOL.filter(() => random() < 0.7).map((dimensionNumber) =>
        makeDimension({
          number: dimensionNumber,
          content: `chunk${cellIndex}-dim${dimensionNumber} prose`,
          metadata: {
            keyTerms: random() < 0.5 ? [`Term${Math.floor(random() * 3)}`, "Shared Term"] : ["Shared Term"],
            confidence: random(),
          },
        }),
      );
      cells.push({ jevChunkIndex: cellIndex, wordCount: Math.floor(random() * 1000) + 1, dimensions });
    }
    return cells;
  }

  it("(a) shuffling input cells never changes JSON.stringify(output)", () => {
    const cells = buildRandomCells(SEED);
    const baseline = JSON.stringify(reduce2(cells, PROPERTY_CELL_COUNT));
    for (let shuffleSeed = 0; shuffleSeed < 50; shuffleSeed++) {
      const shuffled = shuffledCopy(cells, shuffleSeed + 1);
      expect(JSON.stringify(reduce2(shuffled, PROPERTY_CELL_COUNT))).toBe(baseline);
    }
  });

  it("(b) reducing twice equals once (idempotent on the same set)", () => {
    const cells = buildRandomCells(SEED + 100);
    const once = reduce2(cells, PROPERTY_CELL_COUNT);
    // Re-reducing: wrap the reduced output as a single K=1 cell set.
    const twice = reduceGroundedChunks([{ jevChunkIndex: 0, wordCount: 0, dimensions: once.dimensions }], {
      expectedJevChunkCount: 1,
    });
    expect(JSON.stringify(twice.dimensions)).toBe(JSON.stringify(once.dimensions));
    // And on the ORIGINAL set, re-running is trivially identical.
    expect(JSON.stringify(reduce2(cells, PROPERTY_CELL_COUNT))).toBe(JSON.stringify(once));
  });
});

describe("2.5a review fixes", () => {
  const dimension = (number: number, metadata?: UCISDimension["metadata"]): UCISDimension =>
    ({ number, name: `D${number}`, content: `c${number}`, ...(metadata ? { metadata } : {}) }) as UCISDimension;

  it("drops a stale non-finite confidence from the first chunk even when nothing else merges", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = reduceGroundedChunks(
        [
          { jevChunkIndex: 0, wordCount: 10, dimensions: [dimension(1, { confidence: bad })] },
          { jevChunkIndex: 1, wordCount: 10, dimensions: [dimension(1)] },
        ],
        { expectedJevChunkCount: 2 },
      );
      expect(result.dimensions[0]).not.toHaveProperty("metadata");
    }
  });

  it("ignores confidence outside the 0-1 scale", () => {
    const result = reduceGroundedChunks(
      [
        { jevChunkIndex: 0, wordCount: 10, dimensions: [dimension(1, { confidence: 7 })] },
        { jevChunkIndex: 1, wordCount: 10, dimensions: [dimension(1, { confidence: 0.4 })] },
      ],
      { expectedJevChunkCount: 2 },
    );
    expect(result.dimensions[0]?.metadata?.confidence).toBe(0.4);
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN, -1])("rejects a cell wordCount of %s", (wordCount) => {
    expect(() =>
      reduceGroundedChunks([{ jevChunkIndex: 0, wordCount, dimensions: [dimension(1)] }], { expectedJevChunkCount: 2 }),
    ).toThrow(/invalid wordCount/);
  });

  it("marks partial by real chunk indices: present in chunks 1 and 2 of 3 with chunk 0 missing", () => {
    const result = reduceGroundedChunks(
      [
        { jevChunkIndex: 1, wordCount: 10, dimensions: [dimension(1), dimension(2)] },
        { jevChunkIndex: 2, wordCount: 10, dimensions: [dimension(1)] },
      ],
      { expectedJevChunkCount: 3 },
    );
    expect(result.partial).toEqual([1, 2]);
  });

  it("a dimension present in every expected chunk is not partial", () => {
    const result = reduceGroundedChunks(
      [0, 1, 2].map((jevChunkIndex) => ({ jevChunkIndex, wordCount: 10, dimensions: [dimension(4)] })),
      { expectedJevChunkCount: 3 },
    );
    expect(result.partial).toEqual([]);
  });
});

describe('wordCount safety bounds (R3b 2.5 audit)', () => {
  const cell = (jevChunkIndex: number, wordCount: unknown): GroundedCell => ({
    jevChunkIndex,
    wordCount: 100,
    dimensions: [{ number: 1, name: 'D1', content: `chunk ${jevChunkIndex}`, metadata: { wordCount } } as unknown as UCISDimension],
  });

  it('ignores negative, fractional and non-finite per-cell wordCount', () => {
    const out = reduceGroundedChunks([cell(0, 120), cell(1, -50), cell(2, 3.5)], { expectedJevChunkCount: 3 });
    expect(out.dimensions[0]?.metadata?.wordCount).toBe(120);
  });

  it('never emits a sum that overflowed past a safe integer', () => {
    const out = reduceGroundedChunks([cell(0, Number.MAX_SAFE_INTEGER), cell(1, Number.MAX_SAFE_INTEGER)], { expectedJevChunkCount: 2 });
    expect(out.dimensions[0]?.metadata?.wordCount).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('null');
  });
});
