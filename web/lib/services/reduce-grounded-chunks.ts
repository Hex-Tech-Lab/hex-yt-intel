/**
 * ADR 037 Addendum A5: deterministic reduce of K per-chunk grounded outputs
 * into one grounded result before Bundle B.
 *
 * PURE module (no I/O). Input cells carry the per-Jev-chunk grounded
 * dimensions; output is a single deterministic dimension list plus the
 * `partial` list of dimension numbers that were missing from at least one
 * chunk (but present in at least one). A dimension missing from every chunk
 * is absent from the output entirely.
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

export interface ReducedGroundedResult {
  dimensions: UCISDimension[];
  /** Dimension numbers missing from SOME chunks (present in at least one). Ascending. */
  partial: number[];
}

/** Lowercase + collapse internal whitespace: the normalized dedupe key. */
function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Dedupe key for an array item. Timestamped items (objects carrying
 * label/text + timestamp) dedupe by (label, timestamp); plain strings by
 * their normalized text.
 */
function itemKey(item: unknown): string | null {
  if (typeof item === "string") {
    const normalized = normalizeKey(item);
    return normalized.length > 0 ? normalized : null;
  }
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label : typeof record.text === "string" ? record.text : null;
    if (label === null) return null;
    const normalizedLabel = normalizeKey(label);
    if (normalizedLabel.length === 0) return null;
    const timestamp = typeof record.timestamp === "string" ? record.timestamp : "";
    return timestamp.length > 0 ? `${normalizedLabel}|${timestamp}` : normalizedLabel;
  }
  return null;
}

/** Round to the confidence source's 0–1 scale with 4-decimal precision. */
function roundConfidence(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Reduce K grounded cells into one grounded dimension list (A5).
 *
 * Rules:
 * - cells ordered by jevChunkIndex ascending, never by input order;
 * - arrays: concatenated in order, deduped by normalized key (first kept);
 * - prose `content`: per-chunk sections joined with one blank line, no rewriting;
 * - numeric scores (confidence): wordCount-weighted mean over chunks that
 *   have the dimension, rounded to 4 decimals;
 * - dimension missing in some chunks → still produced, listed in `partial`;
 *   missing in all → absent.
 */
export function reduceGroundedChunks(cells: readonly GroundedCell[]): ReducedGroundedResult {
  const ordered = [...cells].sort((first, second) => first.jevChunkIndex - second.jevChunkIndex);

  // Group per-dimension chunk contributions in jevChunkIndex order.
  const byDimension = new Map<number, { cellIndex: number; dimension: UCISDimension; wordCount: number }[]>();
  ordered.forEach((cell, cellIndex) => {
    for (const dimension of cell.dimensions) {
      if (!dimension || typeof dimension.number !== "number" || Number.isNaN(dimension.number)) continue;
      const bucket = byDimension.get(dimension.number);
      const entry = { cellIndex, dimension, wordCount: cell.wordCount };
      if (bucket) bucket.push(entry);
      else byDimension.set(dimension.number, [entry]);
    }
  });

  const totalCells = ordered.length;
  const dimensions: UCISDimension[] = [];
  const partial: number[] = [];

  for (const dimensionNumber of [...byDimension.keys()].sort((first, second) => first - second)) {
    const contributions = byDimension.get(dimensionNumber)!;
    const isFirstChunk = contributions[0]!.cellIndex === 0;
    const isLastChunk = contributions[contributions.length - 1]!.cellIndex === totalCells - 1;
    if (contributions.length < totalCells && !(totalCells === 1 && isFirstChunk && isLastChunk)) {
      partial.push(dimensionNumber);
    }

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
    let hasConfidence = false;
    let name = "";
    for (const contribution of contributions) {
      const metadata = contribution.dimension.metadata;
      const weight = typeof contribution.wordCount === "number" && contribution.wordCount > 0 ? contribution.wordCount : 0;
      if (metadata && typeof metadata.confidence === "number" && Number.isFinite(metadata.confidence)) {
        hasConfidence = true;
        weightedConfidenceSum += metadata.confidence * weight;
        confidenceWeightSum += weight;
      }
      if (typeof metadata?.wordCount === "number") wordCountSum += metadata.wordCount;
      if (metadata?.insufficientData !== true) insufficientDataAll = false;
      if (name.length === 0 && typeof contribution.dimension.name === "string") {
        name = contribution.dimension.name;
      }
    }

    const metadata: UCISDimension["metadata"] = {};
    if (hasKeyTermsField) metadata.keyTerms = keyTerms;
    if (hasConfidence && confidenceWeightSum > 0) {
      metadata.confidence = roundConfidence(weightedConfidenceSum / confidenceWeightSum);
    } else if (hasConfidence) {
      // All-zero weights: fall back to the unweighted mean (deterministic).
      const unweighted =
        contributions.reduce(
          (sum, contribution) => sum + (contribution.dimension.metadata?.confidence ?? 0),
          0,
        ) / contributions.length;
      metadata.confidence = roundConfidence(unweighted);
    }
    if (wordCountSum > 0) metadata.wordCount = wordCountSum;
    if (insufficientDataAll) metadata.insufficientData = true;

    // Spread the FIRST chunk's dimension as the base so a K=1 reduce is an
    // exact passthrough (identical key order and shape), then override the
    // merged fields deterministically.
    const base = contributions[0]!.dimension;
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
