/**
 * Jev semantic boundary engine (ADR 037, R3b step 1).
 *
 * Pure, deterministic, no I/O, no LLM. CDI spec (locked): sliding window of
 * N words, CDI = target terms / total words in window; a boundary candidate
 * is a window start where |ΔCDI| > tau (strictly greater).
 *
 * NOTE on "tokens": there is no tokenizer in this codebase — a "token" here
 * means a whitespace-separated word (see `tokenize`). All min/max chunk
 * parameters operate on those units.
 */

import { FILLER_TERMS, STOPWORDS } from './lexicon';
import { tokenizeTranscript } from './transcript-slice';
import type { JevConfig } from '@/lib/config/jev';

export interface JevWindow {
  start: number;
  end: number;
  cdi: number;
}

export interface JevChunk {
  index: number;
  startWord: number;
  /** Exclusive. */
  endWord: number;
  text: string;
  wordCount: number;
  meanCdi: number;
  /** Windows fully inside the chunk with cdi < fluffCdiThreshold / total such windows; 0 when none. */
  fluffRatio: number;
  forcedCut: boolean;
}

/** Split on whitespace, drop empties. Delegates to the shared isomorphic module (R3b 2.3.5b). */
export function tokenize(transcript: string): string[] {
  return tokenizeTranscript(transcript);
}

function stripPunctuation(word: string): string {
  return word.replace(/^[^\w]+|[^\w]+$/g, '');
}

/**
 * Target-term rule (each rule gated by its count* flag; a filler term is
 * NEVER a target term):
 * - acronym: all-caps form `^[A-Z][A-Z0-9]*$`, length >= acronymMinLength,
 *   at least 2 capitals;
 * - number: starts with a digit;
 * - proper noun: first char uppercase AND a previous word exists AND that
 *   previous word does NOT end with `.`, `?` or `!`;
 * - content word: lowercase form not in STOPWORDS/FILLER_TERMS, letters
 *   only, length >= contentWordMinLength.
 */
export function isTargetTerm(word: string, prevWord: string | undefined, cfg: JevConfig): boolean {
  const stripped = stripPunctuation(word);
  if (stripped.length === 0) return false;
  const lower = stripped.toLowerCase();
  if (FILLER_TERMS.has(lower)) return false;
  if (cfg.countAcronyms && /^[A-Z][A-Z0-9]*$/.test(stripped) && stripped.length >= cfg.acronymMinLength) {
    const capitals = (stripped.match(/[A-Z]/g) ?? []).length;
    if (capitals >= 2) return true;
  }
  if (cfg.countNumbers && /^\d/.test(stripped)) return true;
  if (
    cfg.countProperNouns &&
    prevWord !== undefined &&
    /^[A-Z]/.test(stripped) &&
    !/[.?!]$/.test(prevWord)
  ) {
    return true;
  }
  if (
    cfg.countContentWords &&
    lower === stripped &&
    !STOPWORDS.has(lower) &&
    !FILLER_TERMS.has(lower) &&
    stripped.length >= cfg.contentWordMinLength &&
    /^[a-z]+$/.test(stripped)
  ) {
    return true;
  }
  return false;
}

/**
 * Window t covers [t*stride, min(t*stride+N, words.length)). The last
 * window may be shorter; stop once a window reaches the end. Empty input →
 * empty array. cdi = targets / (end - start).
 */
export function computeWindows(words: string[], cfg: JevConfig): JevWindow[] {
  if (words.length === 0) return [];
  const windows: JevWindow[] = [];
  const wordCount = words.length;
  for (let t = 0; ; t++) {
    const start = t * cfg.windowStrideWords;
    if (start >= wordCount) break;
    const end = Math.min(start + cfg.windowWords, wordCount);
    let targets = 0;
    for (let i = start; i < end; i++) {
      if (isTargetTerm(words[i]!, i > 0 ? words[i - 1] : undefined, cfg)) targets++;
    }
    windows.push({ start, end, cdi: targets / (end - start) });
  }
  return windows;
}

/**
 * Word indexes windows[t].start for every t >= 1 where
 * |windows[t].cdi - windows[t-1].cdi| > tau (strict >). Window 0 is never a
 * candidate.
 */
export function boundaryCandidates(windows: JevWindow[], tau: number): number[] {
  const candidates: number[] = [];
  for (let t = 1; t < windows.length; t++) {
    if (Math.abs(windows[t]!.cdi - windows[t - 1]!.cdi) > tau) {
      candidates.push(windows[t]!.start);
    }
  }
  return candidates;
}

function isSentenceEnd(word: string): boolean {
  return /[.?!]$/.test(word);
}

function mergeUntilWithinMaxChunks(chunks: JevChunk[], words: string[], cfg: JevConfig, windows: JevWindow[]): JevChunk[] {
  let list = chunks;
  while (list.length > cfg.maxChunks) {
    let bestIndex = -1;
    let bestSize = Number.POSITIVE_INFINITY;
    for (let i = 0; i < list.length - 1; i++) {
      const combined = list[i]!.wordCount + list[i + 1]!.wordCount;
      if (combined < bestSize) {
        bestSize = combined;
        bestIndex = i;
      }
    }
    const left = list[bestIndex]!;
    const right = list[bestIndex + 1]!;
    const merged = buildChunk(left.startWord, right.endWord, words, cfg, windows, left.index, left.forcedCut || right.forcedCut);
    const next = [...list];
    next.splice(bestIndex, 2, merged);
    list = next.map((chunk, index) => ({ ...chunk, index }));
  }
  return list;
}

function buildChunk(
  startWord: number,
  endWord: number,
  words: string[],
  cfg: JevConfig,
  windows: JevWindow[],
  index: number,
  forcedCut: boolean
): JevChunk {
  const chunkWords: string[] = [];
  for (let position = startWord; position < endWord; position++) chunkWords.push(words[position]!);
  const inside = windows.filter((win) => win.start >= startWord && win.end <= endWord);
  const meanCdi = inside.length > 0 ? inside.reduce((sum, win) => sum + win.cdi, 0) / inside.length : 0;
  const fluff = inside.filter((win) => win.cdi < cfg.fluffCdiThreshold);
  const fluffRatio = inside.length > 0 ? fluff.length / inside.length : 0;
  return {
    index,
    startWord,
    endWord,
    text: chunkWords.join(' '),
    wordCount: endWord - startWord,
    meanCdi,
    fluffRatio,
    forcedCut,
  };
}

/**
 * Contract: split a raw transcript string into contiguous JevChunks.
 *
 * Input: transcript (any string; '' or whitespace-only → []), a resolved
 * JevConfig. Output: chunks with index 0..k-1 covering [0, wordCount) exactly,
 * contiguous, text = words joined by single space.
 *
 * Cut selection: cursor starts at 0; when the remainder fits within
 * maxChunkTokens it becomes the final chunk. Otherwise a cut c is chosen in
 * [cursor+minChunkTokens, cursor+maxChunkTokens]: prefer the boundary
 * candidate closest to cursor+maxChunkTokens (tie → smaller index), snapped
 * forward to the first sentence end at or after it (cut placed AFTER that
 * word) provided the snapped cut stays <= cursor+maxChunkTokens; if no
 * candidate snaps, the LAST sentence end in range is used; if the range has
 * no sentence end at all (auto-captions), cut at exactly
 * cursor+maxChunkTokens with forcedCut = true. A remainder shorter than
 * minChunkTokens is merged into the current chunk only when the merged size
 * stays <= maxChunkTokens; otherwise it is kept as a short final chunk.
 * After chunking, if more than maxChunks chunks exist, adjacent pairs with
 * the smallest combined word count are merged repeatedly (merges may exceed
 * maxChunkTokens — the documented exception).
 */
export function chunkTranscript(transcript: string, cfg: JevConfig): JevChunk[] {
  const words = tokenize(transcript);
  const wordCount = words.length;
  if (wordCount === 0) return [];
  const windows = computeWindows(words, cfg);
  const candidates = boundaryCandidates(windows, cfg.deltaCdiThreshold);

  const rawRanges: Array<{ start: number; end: number; forcedCut: boolean }> = [];
  let cursor = 0;
  while (cursor < wordCount) {
    if (wordCount - cursor <= cfg.maxChunkTokens) {
      rawRanges.push({ start: cursor, end: wordCount, forcedCut: false });
      break;
    }
    const minCut = cursor + cfg.minChunkTokens;
    const maxCut = cursor + cfg.maxChunkTokens;
    // Candidate closest to maxCut (tie → smaller index), snapped forward to
    // the first sentence end at or after it while staying <= maxCut.
    let chosen = -1;
    let chosenForced = false;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = candidates[i]!;
      if (candidate < minCut) break;
      if (candidate > maxCut) continue;
      if (candidate > chosen) chosen = candidate;
      break; // only the closest candidate matters; take the highest in range
    }
    // Snap the candidate forward to the first sentence end at or after it
    // (cut goes AFTER that word) while staying <= maxCut.
    let cut = -1;
    if (chosen > cursor) {
      for (let i = chosen; i < maxCut; i++) {
        if (isSentenceEnd(words[i]!)) {
          cut = i + 1;
          break;
        }
      }
    }
    // No candidate, or the candidate did not snap: last sentence end in range.
    // (A raw candidate is never used as the cut -- it can be mid-sentence.)
    if (cut === -1) {
      for (let i = maxCut - 1; i >= minCut; i--) {
        if (isSentenceEnd(words[i]!)) {
          cut = i + 1;
          break;
        }
      }
    }
    // No sentence end in range at all (auto-captions): forced cut at maxCut.
    if (cut === -1) {
      cut = maxCut;
      chosenForced = true;
    }
    chosen = cut;
    // A remainder shorter than minChunkTokens is kept as a short final chunk:
    // merging it would exceed maxChunkTokens (n - cursor > maxChunkTokens here,
    // otherwise the final-chunk branch above would have fired).
    rawRanges.push({ start: cursor, end: chosen, forcedCut: chosenForced });
    cursor = chosen;
  }

  let chunks = rawRanges.map((range, index) =>
    buildChunk(range.start, range.end, words, cfg, windows, index, range.forcedCut)
  );
  chunks = mergeUntilWithinMaxChunks(chunks, words, cfg, windows);
  return chunks.map((chunk, index) => ({ ...chunk, index }));
}
