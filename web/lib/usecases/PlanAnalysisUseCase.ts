/**
 * PlanAnalysisUseCase (ADR 037 Addendum A1/A6, R3b step 2.3 — Option P1).
 *
 * Pure, deterministic planner: computes the Jev chunk matrix (K), the
 * stream count (K × G + P), the pre-signed cell list (per-chunk transcript
 * segment triples), and the worst-case cost estimate, enforcing the
 * per-video cost cap by merging the smallest adjacent Jev chunks until the
 * estimate fits. No I/O — the caller resolves config and signs the cells.
 *
 * A segment's canonical text is the whitespace-tokenized words joined by a
 * single space (the same tokenization the boundary engine uses), so the
 * sha256 triple is well-defined for both the Vercel signer and the
 * worker-side re-computation regardless of the transcript's original
 * whitespace irregularities.
 */

import { isProjectiveBundle } from '@/lib/config/synthesis';
import { chunkTranscript, tokenize, type JevChunk } from '@/lib/jev/boundary-engine';
import { sha256Hex } from '@/lib/config/projective-context';
import type { JevConfig } from '@/lib/config/jev';

/** Words-per-token conversion factor from ADR 037 Addendum A6. */
const WORDS_TO_TOKENS_FACTOR = 1.35;

export interface PlanCell {
  /** 0-based Jev conceptual-chunk index. Projective cells are always 0. */
  jevChunkIndex: number;
  /** 1-based bundle index (bundle index + 1), same meaning as analysis_chunks.chunk_index. */
  chunkIndex: number;
  startWord: number;
  /** Exclusive. */
  endWord: number;
  sha256: string;
}

export interface AnalysisPlan {
  /** Number of Jev chunks (1 when Jev is disabled or the fallback path ran). */
  K: number;
  /** K × G + P — the analysis_chunks completeness count (A2). */
  streamCount: number;
  /**
   * One cell per (jevChunkIndex, grounded bundle) plus one per projective
   * bundle at jevChunkIndex 0. Grounded bundles of the same chunk share an
   * identical (startWord, endWord, sha256) triple.
   */
  cells: PlanCell[];
  /** Worst-case estimate in USD cents (A6 formula, most-expensive price). */
  estimateCents: number;
  /** True when even K=1 exceeds the cost cap — the caller falls back to today's transcriptBudgetChars truncation path. */
  truncatedFallback: boolean;
}

export interface PlanAnalysisInput {
  transcript: string;
  jevConfig: JevConfig;
  /** Resolved `analysis.streamBundles` partition (validated upstream). */
  bundles: number[][];
  /** Today's truncation path stays the last-resort fallback (A6). */
  transcriptBudgetChars: number;
  /** Registry key `analysis.jev.maxCostUsdCentsPerVideo`. */
  costCapCents: number;
  /** Worst-case (most expensive resolved-cascade model) price in USD per million input tokens. */
  inputUsdPerMTok: number;
  /** Worst-case price in USD per million output tokens. */
  outputUsdPerMTok: number;
  /** Shared prompt prefix tokens sent with every grounded cell call. */
  promptPrefixTokens: number;
  /** Registry-resolved per-call output cap (analysis.maxOutputTokens.*). */
  maxOutputTokens: number;
}

interface MergedChunk {
  startWord: number;
  endWord: number;
  wordCount: number;
  text: string;
}

function mergeChunks(chunks: JevChunk[], words: string[]): MergedChunk[] {
  return chunks.map((chunk) => ({
    startWord: chunk.startWord,
    endWord: chunk.endWord,
    wordCount: chunk.wordCount,
    text: words.filter((_unusedWord, wordIndex) => wordIndex >= chunk.startWord && wordIndex < chunk.endWord).join(' '),
  }));
}

/** A6: merge the smallest adjacent pair (smallest combined word count) once. */
function mergeSmallestAdjacent(chunks: MergedChunk[]): MergedChunk[] {
  let bestIdx = -1;
  let bestSize = Number.POSITIVE_INFINITY;
  for (let i = 0; i < chunks.length - 1; i++) {
    const combined = chunks[i]!.wordCount + chunks[i + 1]!.wordCount;
    if (combined < bestSize) {
      bestSize = combined;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return chunks;
  const leftChunk = chunks[bestIdx]!;
  const rightChunk = chunks[bestIdx + 1]!;
  const merged: MergedChunk = {
    startWord: leftChunk.startWord,
    endWord: rightChunk.endWord,
    wordCount: leftChunk.wordCount + rightChunk.wordCount,
    text: `${leftChunk.text} ${rightChunk.text}`,
  };
  return chunks.flatMap((chunk, chunkIndex) => {
    if (chunkIndex === bestIdx) return [merged];
    if (chunkIndex === bestIdx + 1) return [];
    return [chunk];
  });
}

function perCallInputTokens(chunkWords: number, input: PlanAnalysisInput): number {
  return chunkWords * WORDS_TO_TOKENS_FACTOR + input.promptPrefixTokens;
}

function estimateCentsFor(chunks: MergedChunk[], groundedBundles: number, projectiveBundles: number, input: PlanAnalysisInput): number {
  const perMillion = 1_000_000;
  let total = 0;
  for (const chunk of chunks) {
    for (let g = 0; g < groundedBundles; g++) {
      total += perCallInputTokens(chunk.wordCount, input) * input.inputUsdPerMTok + input.maxOutputTokens * input.outputUsdPerMTok;
    }
  }
  for (let p = 0; p < projectiveBundles; p++) {
    total += input.promptPrefixTokens * input.inputUsdPerMTok + input.maxOutputTokens * input.outputUsdPerMTok;
  }
  return (total / perMillion) * 100;
}

export async function planAnalysis(input: PlanAnalysisInput): Promise<AnalysisPlan> {
  const groundedBundles = input.bundles.filter((bundle) => !isProjectiveBundle(bundle)).length;
  const projectiveBundles = input.bundles.length - groundedBundles;

  const words = tokenize(input.transcript);
  const withinCharBudget = input.transcript.length <= input.transcriptBudgetChars;

  // K = 1 when Jev is disabled or the transcript fits today's budget (A1).
  if (!input.jevConfig.enabled || withinCharBudget) {
    const text = words.join(' ');
    const sha256 = await sha256Hex(text);
    const groundedBundleIndexes = input.bundles
      .map((bundle, bundleIdx) => ({ bundle, bundleIdx }))
      .filter(({ bundle }) => !isProjectiveBundle(bundle))
      .map(({ bundleIdx }) => bundleIdx + 1);
    const projectiveBundleIndexes = input.bundles
      .map((bundle, bundleIdx) => ({ bundle, bundleIdx }))
      .filter(({ bundle }) => isProjectiveBundle(bundle))
      .map(({ bundleIdx }) => bundleIdx + 1);
    const cells: PlanCell[] = [
      ...groundedBundleIndexes.map((chunkIndex) => ({
        jevChunkIndex: 0,
        chunkIndex,
        startWord: 0,
        endWord: words.length,
        sha256,
      })),
      ...projectiveBundleIndexes.map((chunkIndex) => ({
        jevChunkIndex: 0,
        chunkIndex,
        startWord: 0,
        endWord: words.length,
        sha256,
      })),
    ];
    const singleChunk: MergedChunk[] = [{ startWord: 0, endWord: words.length, wordCount: words.length, text }];
    const estimateCents = estimateCentsFor(singleChunk, groundedBundles, projectiveBundles, input);
    return {
      K: 1,
      streamCount: groundedBundles + projectiveBundles,
      cells,
      estimateCents,
      truncatedFallback: estimateCents > input.costCapCents,
    };
  }

  let chunks = mergeChunks(chunkTranscript(input.transcript, input.jevConfig), words);
  if (chunks.length > input.jevConfig.maxChunks) {
    // Mirror the engine's documented exception: over maxChunks, merge the
    // smallest adjacent pair repeatedly (merges may exceed maxChunkTokens).
    while (chunks.length > input.jevConfig.maxChunks) {
      chunks = mergeSmallestAdjacent(chunks);
    }
  }

  let estimateCents = estimateCentsFor(chunks, groundedBundles, projectiveBundles, input);
  while (estimateCents > input.costCapCents && chunks.length > 1) {
    chunks = mergeSmallestAdjacent(chunks);
    estimateCents = estimateCentsFor(chunks, groundedBundles, projectiveBundles, input);
  }
  const truncatedFallback = estimateCents > input.costCapCents && chunks.length === 1;

  const groundedBundleIndexes = input.bundles
    .map((bundle, bundleIdx) => ({ bundle, bundleIdx }))
    .filter(({ bundle }) => !isProjectiveBundle(bundle))
    .map(({ bundleIdx }) => bundleIdx + 1);
  const projectiveBundleIndexes = input.bundles
    .map((bundle, bundleIdx) => ({ bundle, bundleIdx }))
    .filter(({ bundle }) => isProjectiveBundle(bundle))
    .map(({ bundleIdx }) => bundleIdx + 1);

  const cells: PlanCell[] = [];
  for (let k = 0; k < chunks.length; k++) {
    const chunk = chunks[k]!;
    const sha256 = await sha256Hex(chunk.text);
    for (const chunkIndex of groundedBundleIndexes) {
      cells.push({ jevChunkIndex: k, chunkIndex, startWord: chunk.startWord, endWord: chunk.endWord, sha256 });
    }
    if (k === 0) {
      for (const chunkIndex of projectiveBundleIndexes) {
        cells.push({ jevChunkIndex: 0, chunkIndex, startWord: 0, endWord: 0, sha256: await sha256Hex('') });
      }
    }
  }

  return {
    K: chunks.length,
    streamCount: chunks.length * groundedBundles + projectiveBundles,
    cells,
    estimateCents,
    truncatedFallback,
  };
}
