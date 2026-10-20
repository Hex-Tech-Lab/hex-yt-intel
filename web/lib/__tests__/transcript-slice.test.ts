/**
 * R3b 2.3.5b — shared isomorphic transcript-slice module tests.
 *
 * Covers: tokenization whitespace edge cases, sliceText bounds/RangeErrors,
 * EMPTY_SLICE_SHA256 == sha256(""), a known SHA-256 vector, and the web↔worker
 * PARITY test: every PlanCell's sha256 from planAnalysis recomputed through
 * the WORKER re-export (sliceDigest) must match, projective cells included.
 */

import { describe, expect, it } from 'vitest';
import { JEV_DEFAULTS } from '@/lib/config/jev';
import {
  EMPTY_SLICE_SHA256,
  sha256HexIsomorphic,
  sliceDigest,
  sliceText,
  tokenizeTranscript,
} from '@/lib/jev/transcript-slice';
import { tokenize } from '@/lib/jev/boundary-engine';
import { planAnalysis, type PlanAnalysisInput } from '@/lib/usecases/PlanAnalysisUseCase';
import {
  EMPTY_SLICE_SHA256 as WORKER_EMPTY_SLICE_SHA256,
  sliceDigest as workerSliceDigest,
  sliceText as workerSliceText,
  tokenizeTranscript as workerTokenizeTranscript,
} from '../../../worker/src/services/TranscriptSlice';

describe('tokenizeTranscript', () => {
  it('splits on spaces, tabs, newlines, carriage returns', () => {
    expect(tokenizeTranscript('a b\tc\nd\r\ne')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('collapses multiple consecutive spaces', () => {
    expect(tokenizeTranscript('a    b  c')).toEqual(['a', 'b', 'c']);
  });

  it('drops leading and trailing whitespace', () => {
    expect(tokenizeTranscript('   hello world   ')).toEqual(['hello', 'world']);
  });

  it('returns empty array for whitespace-only or empty input', () => {
    expect(tokenizeTranscript('')).toEqual([]);
    expect(tokenizeTranscript('   \t\n  ')).toEqual([]);
  });

  it('preserves unicode words intact', () => {
    expect(tokenizeTranscript('café naïve 日本語')).toEqual(['café', 'naïve', '日本語']);
  });

  it('is identical to boundary-engine tokenize (delegation)', () => {
    const sample = 'alpha  beta\tgamma\ndelta epsilon';
    expect(tokenize(sample)).toEqual(tokenizeTranscript(sample));
  });
});

describe('sliceText', () => {
  const words = ['a', 'b', 'c', 'd', 'e'];

  it('joins the half-open [start, end) range with a single space', () => {
    expect(sliceText(words, 1, 3)).toBe('b c');
    expect(sliceText(words, 0, words.length)).toBe('a b c d e');
    expect(sliceText(words, 2, 2)).toBe('');
    expect(sliceText(words, 0, 0)).toBe('');
  });

  it('throws RangeError for non-integer bounds', () => {
    expect(() => sliceText(words, 0.5, 2)).toThrow(RangeError);
    expect(() => sliceText(words, 0, Number.NaN)).toThrow(RangeError);
  });

  it('throws RangeError for start < 0', () => {
    expect(() => sliceText(words, -1, 2)).toThrow(RangeError);
  });

  it('throws RangeError for start > end', () => {
    expect(() => sliceText(words, 3, 2)).toThrow(RangeError);
  });

  it('throws RangeError for end > words.length', () => {
    expect(() => sliceText(words, 0, 6)).toThrow(RangeError);
  });

  it('worker re-export behaves identically', () => {
    expect(workerSliceText(words, 1, 3)).toBe('b c');
    expect(() => workerSliceText(words, -1, 2)).toThrow(RangeError);
    expect(workerTokenizeTranscript('a  b\tc')).toEqual(['a', 'b', 'c']);
  });
});

describe('sha256HexIsomorphic', () => {
  it('matches the known sha256("abc") vector', async () => {
    expect(await sha256HexIsomorphic('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('returns lowercase hex', async () => {
    const hex = await sha256HexIsomorphic('x');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('EMPTY_SLICE_SHA256 equals sha256("")', async () => {
    expect(EMPTY_SLICE_SHA256).toBe(await sha256HexIsomorphic(''));
    expect(WORKER_EMPTY_SLICE_SHA256).toBe(await sha256HexIsomorphic(''));
  });

  it('sliceDigest composes tokenize + sliceText + hash', async () => {
    const transcript = 'one  two\tthree four';
    expect(await sliceDigest(transcript, 1, 3)).toBe(await sha256HexIsomorphic('two three'));
    expect(await sliceDigest(transcript, 0, 0)).toBe(EMPTY_SLICE_SHA256);
  });
});

// ---------------------------------------------------------------------------
// PARITY test: planAnalysis (web) vs worker re-export (R3b 2.3.5b contract).
// ---------------------------------------------------------------------------

const BASE: Omit<PlanAnalysisInput, 'transcript'> = {
  jevConfig: JEV_DEFAULTS,
  bundles: [
    [1, 10],
    [2, 4, 6],
    [5, 7],
    [3, 8],
    [9, 11],
  ],
  transcriptBudgetChars: 200, // force K>1 with the transcript below
  costCapCents: Number.POSITIVE_INFINITY,
  inputUsdPerMTok: 1.5,
  outputUsdPerMTok: 7.5,
  promptPrefixTokens: 1_000,
  maxOutputTokens: 8_192,
};

/** Fixed multi-chunk transcript with irregular whitespace (long enough to force K>1). */
const PARITY_TRANSCRIPT = (() => {
  const sentences = [
    '  The core idea is simple:   measure what matters,',
    'ignore the rest,\tand iterate quickly on the results.',
    'But measuring   what matters requires knowing\r\n',
    'which signals are noise and which are   signal.',
    'That distinction drives every decision that follows.  ',
  ];
  const parts: string[] = [];
  for (let i = 0; i < 900; i++) {
    parts.push(sentences[i % sentences.length]!.trim());
  }
  return parts.join('\n\t ');
})();

describe('PARITY: planAnalysis cells vs worker sliceDigest (K>1 forced)', () => {
  it('every returned cell (projective included) recomputes identically via the worker re-export', async () => {
    const plan = await planAnalysis({
      ...BASE,
      transcript: PARITY_TRANSCRIPT,
      jevConfig: { ...JEV_DEFAULTS, enabled: true },
    });
    expect(plan.K).toBeGreaterThan(1);

    const cells = plan.cells;
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const recomputed = await workerSliceDigest(PARITY_TRANSCRIPT, cell.startWord, cell.endWord);
      expect(recomputed).toBe(cell.sha256);
    }
    // Projective cells specifically: empty slice, hashed via the worker path.
    const projectiveCells = cells.filter((c) => c.startWord === 0 && c.endWord === 0);
    expect(projectiveCells.length).toBeGreaterThan(0);
    for (const cell of projectiveCells) {
      expect(cell.sha256).toBe(WORKER_EMPTY_SLICE_SHA256);
    }
  });

  it('K=1 fallback path also matches through the worker re-export', async () => {
    const plan = await planAnalysis({ ...BASE, transcript: 'short transcript text' });
    for (const cell of plan.cells) {
      expect(await workerSliceDigest('short transcript text', cell.startWord, cell.endWord)).toBe(cell.sha256);
    }
  });
});
