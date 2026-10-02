/**
 * ADR 037 Addendum A5: deterministic reduce of K per-chunk grounded outputs
 * into one grounded result before Bundle B.
 *
 * PURE module (no I/O). Input cells carry the per-Jev-chunk grounded
 * dimensions; output is a single deterministic dimension list plus the
 * `partial` list of dimension numbers that were missing from at least one
 * EXPECTED chunk index (but present in at least one received cell). A chunk
 * index in [0, expectedJevChunkCount) with no cell at all counts as missing
 * for every dimension. A dimension missing from every received cell is absent
 * from the output entirely.
 *
 * Key-term dedupe is case/whitespace-insensitive BY DESIGN (display keywords;
 * e.g. "Compound Interest" and "compound  interest" are the same keyword).
 *
 * Confidence on a `partial` dimension is CONDITIONAL: it is the weighted mean
 * over only the contributing chunks, so it reflects the chunks that actually
 * produced the dimension, not the full expected chunk count.
 *
 * Determinism contract: the output is byte-identical (JSON.stringify) for the
 * same cell SET regardless of input order — cells are always processed in
 * ascending jevChunkIndex order, never input order.
 */
import type { UCISDimension } from "@/lib/types/dimension";

export interface GroundedCell {
  jevChunkIndex: number;
  wordCount: number;
  dimensions: UCISDimension[];
}

/** Options bag: `expectedJevChunkCount` is REQUIRED and validated. */
export interface ReduceGroundedChunksOptions {
  /** Total number of Jev chunks the upstream segmentation produced. */
  expectedJevChunkCount: number;
}

export interface ReducedGroundedResult {
  dimensions: UCISDimension[];
  /** Dimension numbers missing from SOME expected chunks (present in at least one). Ascending. */
  partial: number[];
}

/** Lowercase + collapse internal whitespace: the normalized dedupe key. */
function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Dedupe key for an array item: plain strings by their normalized text.
 * The public type of keyTerms is string[], so non-string items are dropped.
 */
function itemKey(item: unknown): string | null {
  if (typeof item !== "string") return null;
  const normalized = normalizeKey(item);
  return normalized.length > 0 ? normalized : null;
}

/** A confidence counts only when it is a finite number on the 0–1 scale. */
function isUsableConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Round to the confidence source's 0–1 scale with 4-decimal precision. */
function roundConfidence(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Validate the REQUIRED option; throws a descriptive Error when invalid. */
function validateExpectedCount(expectedJevChunkCount: unknown): number {
  if (!isSafeInteger(expectedJevChunkCount) || expectedJevChunkCount <= 0) {
    throw new Error(
      `reduceGroundedChunks: expectedJevChunkCount must be a positive safe integer, received ${String(
        expectedJevChunkCount,
      )}`,
    );
  }
  return expectedJevChunkCount;
}

/** Validate every cell's jevChunkIndex; throws on the first invalid/duplicate. */
function validateCells(cells: readonly GroundedCell[], expectedJevChunkCount: number): void {
  const seen = new Set<number>();
  for (const cell of cells) {
    const index = cell?.jevChunkIndex;
    if (!isSafeInteger(index) || index < 0 || index >= expectedJevChunkCount) {
      throw new Error(
        `reduceGroundedChunks: jevChunkIndex must be a safe integer in [0, ${expectedJevChunkCount}), received ${String(
          index,
        )}`,
      );
    }
    if (seen.has(index)) {
      throw new Error(`reduceGroundedChunks: duplicate jevChunkIndex ${index} across cells`);
    }
    seen.add(index);
    // The cell weight drives the confidence mean: Infinity or a negative value
    // would turn it into NaN or invert it (2.5a, review P2/P3).
    if (typeof cell.wordCount !== "number" || !Number.isFinite(cell.wordCount) || cell.wordCount < 0) {
      throw new Error(
        `reduceGroundedChunks: cell with jevChunkIndex ${index} has invalid wordCount ${String(cell.wordCount)} (finite, >= 0)`,
      );
    }

    const dimensionNumbers = new Set<number>();
    for (const dimension of cell.dimensions) {
      if (dimension === null || dimension === undefined) continue;
      if (!isSafeInteger(dimension.number)) {
        throw new Error(
          `reduceGroundedChunks: cell with jevChunkIndex ${index} has a dimension with invalid number ${String(
            dimension.number,
          )}`,
        );
      }
      if (dimensionNumbers.has(dimension.number)) {
        throw new Error(
          `reduceGroundedChunks: cell with jevChunkIndex ${index} has duplicate dimension number ${dimension.number}`,
        );
      }
      dimensionNumbers.add(dimension.number);
    }
  }
}

/**
 * Reduce K grounded cells into one grounded dimension list (A5).
 *
 * Rules:
 * - `expectedJevChunkCount` is REQUIRED: a positive safe integer, else throw;
 * - every cell's jevChunkIndex must be a safe integer in
 *   [0, expectedJevChunkCount) — out-of-range/invalid/duplicate → throw;
 * - a cell with two dimensions sharing the same number → throw;
 * - cells ordered by jevChunkIndex ascending, never by input order;
 * - arrays: concatenated in order, deduped by normalized key (first kept) —
 *   case/whitespace-insensitive by design (display keywords);
 * - prose `content`: per-chunk sections joined with one blank line, no rewriting;
 * - numeric scores (confidence): wordCount-weighted mean over chunks that
 *   have the dimension and a finite confidence; when the total weight is 0,
 *   the plain mean over the finite confidences; when there are none, the
 *   `confidence` key is OMITTED (never 0);
 * - dimension missing from ANY expected chunk index (including chunk indices
 *   with no cell at all) → still produced, listed in `partial`;
 *   missing from every received cell → absent;
 * - K=1 passthrough: when expectedJevChunkCount === 1 and exactly one valid
 *   cell is supplied, its dimensions are returned unchanged (same objects,
 *   deep-equal, no rounding, no dedupe) and partial is [].
 */
export function reduceGroundedChunks(
  cells: readonly GroundedCell[],
  { expectedJevChunkCount }: ReduceGroundedChunksOptions,
): ReducedGroundedResult {
  const expectedCount = validateExpectedCount(expectedJevChunkCount);
  validateCells(cells, expectedCount);

  // K=1 fast path: exact passthrough of the single cell's dimensions.
  if (expectedCount === 1) {
    const only = cells[0];
    if (cells.length === 1 && only) {
      return { dimensions: [...only.dimensions], partial: [] };
    }
    // expectedCount 1 with zero cells: every index [0,1) is missing → fall
    // through to the general path, which yields an empty result.
  }

  const ordered = [...cells].sort((first, second) => first.jevChunkIndex - second.jevChunkIndex);

  // Group per-dimension chunk contributions in jevChunkIndex order.
  const byDimension = new Map<number, { jevChunkIndex: number; dimension: UCISDimension; wordCount: number }[]>();
  ordered.forEach((cell) => {
    for (const dimension of cell.dimensions) {
      if (!dimension) continue;
      const bucket = byDimension.get(dimension.number);
      const entry = { jevChunkIndex: cell.jevChunkIndex, dimension, wordCount: cell.wordCount };
      if (bucket) bucket.push(entry);
      else byDimension.set(dimension.number, [entry]);
    }
  });

  const dimensions: UCISDimension[] = [];
  const partial: number[] = [];

  for (const dimensionNumber of [...byDimension.keys()].sort((first, second) => first - second)) {
    const contributions = byDimension.get(dimensionNumber) ?? [];

    // Cells have unique in-range jevChunkIndex values and at most one
    // dimension per number (validated above), so a dimension is partial
    // exactly when fewer chunks contributed it than were expected, whether a
    // chunk's cell is missing or present without this dimension.
    if (contributions.length < expectedCount) partial.push(dimensionNumber);

    // Prose: join per-chunk content sections in order with one blank line.
    const content = contributions
      .map((contribution) => contribution.dimension.content)
      .filter((section) => typeof section === "string" && section.length > 0)
      .join("\n\n");

    // Arrays: concatenate in order, dedupe by normalized key, keep first.
    // The field is emitted whenever ANY source chunk carried it — including
    // as an empty array — so a K=1 reduce preserves the input shape exactly.
    const seenKeys = new Set<string>();
    const keyTerms: string[] = [];
    let hasKeyTermsField = false;
    for (const contribution of contributions) {
      const terms = contribution.dimension.metadata?.keyTerms;
      if (!Array.isArray(terms)) continue;
      hasKeyTermsField = true;
      for (const term of terms) {
        const dedupeKey = itemKey(term);
        if (dedupeKey === null || seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        keyTerms.push(term as string);
      }
    }

    // Numeric scores: wordCount-weighted mean over chunks that have the dimension.
    let weightedConfidenceSum = 0;
    let confidenceWeightSum = 0;
    let wordCountSum = 0;
    let insufficientDataAll = true;
    let name = "";
    for (const contribution of contributions) {
      const metadata = contribution.dimension.metadata;
      const weight = typeof contribution.wordCount === "number" && contribution.wordCount > 0 ? contribution.wordCount : 0;
      if (metadata && isUsableConfidence(metadata.confidence)) {
        weightedConfidenceSum += metadata.confidence * weight;
        confidenceWeightSum += weight;
      }
      // LLM-written: only finite, non-negative integers count (negatives would
      // silently shrink the total; a huge value can overflow to Infinity,
      // which JSON serializes as null).
      if (isSafeInteger(metadata?.wordCount) && metadata.wordCount >= 0) wordCountSum += metadata.wordCount;
      if (metadata?.insufficientData !== true) insufficientDataAll = false;
      if (name.length === 0 && typeof contribution.dimension.name === "string") {
        name = contribution.dimension.name;
      }
    }

    const metadata: UCISDimension["metadata"] = {};
    if (hasKeyTermsField) metadata.keyTerms = keyTerms;
    if (confidenceWeightSum > 0) {
      metadata.confidence = roundConfidence(weightedConfidenceSum / confidenceWeightSum);
    } else {
      // Total weight is 0: fall back to the plain mean over ONLY the finite
      // confidences; if there are none, omit `confidence` entirely (never 0).
      const finiteConfidences: number[] = [];
      for (const contribution of contributions) {
        const confidence = contribution.dimension.metadata?.confidence;
        if (isUsableConfidence(confidence)) finiteConfidences.push(confidence);
      }
      if (finiteConfidences.length > 0) {
        metadata.confidence = roundConfidence(finiteConfidences.reduce((sum, value) => sum + value, 0) / finiteConfidences.length);
      }
    }
    if (wordCountSum > 0 && Number.isSafeInteger(wordCountSum)) metadata.wordCount = wordCountSum;
    if (insufficientDataAll) metadata.insufficientData = true;

    // Spread the FIRST chunk's dimension as the base, then override the
    // merged fields deterministically.
    // The first chunk's dimension is the base for untouched fields, but its
    // own metadata is always replaced by the merged one: a stale non-finite
    // confidence must never survive when nothing else merges (2.5a, review P2).
    const first = contributions[0];
    if (!first) continue;
    const { metadata: _baseMetadata, ...base } = first.dimension;
    void _baseMetadata;
    dimensions.push({
      ...base,
      number: dimensionNumber,
      name: name || base.name || `Dimension ${dimensionNumber}`,
      content,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
  }

  return { dimensions, partial };
}
