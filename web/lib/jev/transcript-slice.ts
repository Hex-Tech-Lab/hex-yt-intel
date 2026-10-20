/**
 * R3b 2.3.5b — shared, isomorphic transcript-slice module (ADR 037 2.3.5).
 *
 * Single source of truth for the transcript word-splitting, slice-joining and
 * SHA-256 hashing used to build the per-cell (startWord, endWord, sha256)
 * triples signed by the Vercel planner and re-cut/re-hashed by the worker
 * (R3b 2.3.5d). A one-character difference in split/join behavior between the
 * two sides breaks every signature, so both import THIS module.
 *
 * Isomorphic constraints (contract): no `@/` alias imports, no `env`, no
 * Node-only modules, no Next.js — only Web Crypto (`crypto.subtle`) and
 * plain TypeScript. The worker imports it via the thin re-export in
 * `worker/src/services/TranscriptSlice.ts` (same pattern as
 * KnowledgeGraphSynthesizer).
 */

/**
 * Whitespace word-splitting: split on runs of whitespace, drop empties.
 * Byte-identical to the original `tokenize` in boundary-engine.ts.
 */
export function tokenizeTranscript(transcript: string): string[] {
  return transcript.split(/\s+/).filter((word) => word.length > 0);
}

/**
 * Join `words[start, end)` with a single space. The canonical text a
 * (startWord, endWord, sha256) triple signs. `sliceText(words, 0, 0)` is the
 * projective cells' empty slice (`""`).
 *
 * Throws a RangeError for non-integer bounds, start < 0, start > end, or
 * end > words.length — fail loudly rather than sign a mis-sliced string.
 */
export function sliceText(words: string[], startWord: number, endWord: number): string {
  if (!Number.isInteger(startWord) || !Number.isInteger(endWord)) {
    throw new RangeError(`sliceText bounds must be integers, got start=${startWord} end=${endWord}`);
  }
  if (startWord < 0) {
    throw new RangeError(`sliceText startWord must be >= 0, got ${startWord}`);
  }
  if (startWord > endWord) {
    throw new RangeError(`sliceText startWord (${startWord}) must be <= endWord (${endWord})`);
  }
  if (endWord > words.length) {
    throw new RangeError(`sliceText endWord (${endWord}) must be <= words.length (${words.length})`);
  }
  return words.slice(startWord, endWord).join(' ');
}

/** Lowercase-hex SHA-256 via Web Crypto (same body as projective-context's sha256Hex). */
export async function sha256HexIsomorphic(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 of the empty slice (`""`) — the constant signed by projective cells. */
export const EMPTY_SLICE_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Compose the triple's third element: tokenize the transcript, cut the slice,
 * hash it. This is the exact computation both sides must agree on byte for
 * byte.
 */
export function sliceDigest(transcript: string, startWord: number, endWord: number): Promise<string> {
  return sha256HexIsomorphic(sliceText(tokenizeTranscript(transcript), startWord, endWord));
}
