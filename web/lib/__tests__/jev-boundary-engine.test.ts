import { describe, expect, it } from 'vitest';
import { JEV_DEFAULTS, resolveJevConfig, type JevConfig } from '@/lib/config/jev';
import { boundaryCandidates, chunkTranscript, computeWindows, isTargetTerm, tokenize } from '@/lib/jev/boundary-engine';

const CFG: JevConfig = resolveJevConfig({});

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const DENSE_SENTENCES = [
  'The NASA API returned 42 metrics for OpenAI and Anthropic.',
  'Chapter 3 covers GDPR compliance with 15 examples from Adobe Systems.',
  'Investors tracked USD EUR conversions across 12 quarters of 2023 data.',
];
const FILLER_SENTENCES = [
  'um so basically you know like yeah okay right',
  'so uh like literally actually yeah um okay',
];
const PUNCTUATION_FREE = [
  'the system processes data through several layers before output',
  'teams at google and microsoft both published similar research findings',
];

function buildTranscript(rand: () => number): string {
  const sentences: string[] = [];
  const count = 20 + Math.floor(rand() * 80);
  for (let i = 0; i < count; i++) {
    const roll = rand();
    if (roll < 0.4) sentences.push(DENSE_SENTENCES[Math.floor(rand() * DENSE_SENTENCES.length)]!);
    else if (roll < 0.7) sentences.push(FILLER_SENTENCES[Math.floor(rand() * FILLER_SENTENCES.length)]!);
    else sentences.push(PUNCTUATION_FREE[Math.floor(rand() * PUNCTUATION_FREE.length)]!);
  }
  return sentences.join(' ');
}

const TRANSCRIPTS: string[] = (() => {
  const rand = mulberry32(0x5eed);
  const list: string[] = [];
  for (let i = 0; i < 200; i++) list.push(buildTranscript(rand));
  return list;
})();

describe('tokenize', () => {
  it('splits on whitespace and drops empties', () => {
    expect(tokenize('  hello   world  ')).toEqual(['hello', 'world']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   \t\n  ')).toEqual([]);
  });
});

describe('isTargetTerm', () => {
  it('acronyms: all-caps with >= 2 capitals and length >= acronymMinLength', () => {
    expect(isTargetTerm('NASA', undefined, CFG)).toBe(true);
    expect(isTargetTerm('API', undefined, CFG)).toBe(true);
    expect(isTargetTerm('(API)', undefined, CFG)).toBe(true);
    expect(isTargetTerm('AB', undefined, CFG)).toBe(true);
  });

  it('acronym flag off disables the acronym rule', () => {
    const cfg = resolveJevConfig({ 'analysis.jev.countAcronyms': false });
    expect(isTargetTerm('NASA', undefined, cfg)).toBe(false);
  });

  it('acronym below min length or single capital is not a target', () => {
    expect(isTargetTerm('A', undefined, CFG)).toBe(false);
    expect(isTargetTerm('I', undefined, CFG)).toBe(false);
  });

  it('numbers: words starting with a digit', () => {
    expect(isTargetTerm('42', undefined, CFG)).toBe(true);
    expect(isTargetTerm('42%', undefined, CFG)).toBe(true);
  });

  it('number flag off disables the number rule', () => {
    const cfg = resolveJevConfig({ 'analysis.jev.countNumbers': false });
    expect(isTargetTerm('42', undefined, cfg)).toBe(false);
  });

  it('proper nouns: capitalized mid-sentence only', () => {
    expect(isTargetTerm('Adobe', 'from', CFG)).toBe(true);
    expect(isTargetTerm('The', undefined, CFG)).toBe(false);
    expect(isTargetTerm('The', 'end.', CFG)).toBe(false);
  });

  it('proper-noun flag off disables the proper-noun rule', () => {
    const cfg = resolveJevConfig({ 'analysis.jev.countProperNouns': false });
    expect(isTargetTerm('Adobe', 'from', cfg)).toBe(false);
  });

  it('content words: letters only, not stopwords/filler, length >= min', () => {
    expect(isTargetTerm('system', undefined, CFG)).toBe(true);
    expect(isTargetTerm('data.', undefined, CFG)).toBe(true);
    expect(isTargetTerm('the', undefined, CFG)).toBe(false);
    expect(isTargetTerm('cat', undefined, CFG)).toBe(false);
    expect(isTargetTerm('42abc', undefined, CFG)).toBe(true);
  });

  it('content-word flag off disables the content-word rule', () => {
    const cfg = resolveJevConfig({ 'analysis.jev.countContentWords': false });
    expect(isTargetTerm('system', undefined, cfg)).toBe(false);
  });

  it('filler terms are never target terms under any flag', () => {
    const cfg = resolveJevConfig({
      'analysis.jev.countContentWords': true,
      'analysis.jev.countProperNouns': true,
      'analysis.jev.countNumbers': true,
      'analysis.jev.countAcronyms': true,
    });
    for (const filler of ['um', 'uh', 'like', 'basically', 'literally', 'actually', 'yeah', 'okay', 'so', 'right', 'sponsor', 'sponsored', 'promo', 'discount', 'subscribe']) {
      expect(isTargetTerm(filler, undefined, cfg)).toBe(false);
    }
    expect(isTargetTerm('Like', 'and', CFG)).toBe(false);
  });
});

describe('computeWindows — exact values', () => {
  it('250 words with N=100, S=100 → [0,100) [100,200) [200,250)', () => {
    const words = Array.from({ length: 250 }, (_v, i) => `w${i}`);
    const windows = computeWindows(words, { ...CFG, windowWords: 100, windowStrideWords: 100 });
    expect(windows).toHaveLength(3);
    expect(windows[0]).toEqual({ start: 0, end: 100, cdi: 0 });
    expect(windows[1]).toEqual({ start: 100, end: 200, cdi: 0 });
    expect(windows[2]).toEqual({ start: 200, end: 250, cdi: 0 });
  });

  it('250 words with S=50 → starts 0,50,100,150,200', () => {
    const words = Array.from({ length: 250 }, (_v, i) => `w${i}`);
    const windows = computeWindows(words, { ...CFG, windowWords: 100, windowStrideWords: 50 });
    expect(windows.map((w) => w.start)).toEqual([0, 50, 100, 150, 200]);
    expect(windows.every((window, position) => position === windows.length - 1 || window.end - window.start === 100)).toBe(true);
    expect(windows[windows.length - 1]).toEqual({ start: 200, end: 250, cdi: 0 });
  });

  it('empty input → []', () => {
    expect(computeWindows([], CFG)).toEqual([]);
  });
});

describe('boundaryCandidates — hand-computed ΔCDI', () => {
  // Windows with CDIs 0.0, 0.5, 0.25 (Δ = 0.5, 0.25) and tau = 0.3:
  // |0.5 - 0.0| = 0.5 > 0.3 → candidate at window 1's start.
  // |0.25 - 0.5| = 0.25, NOT > 0.3 → not a candidate.
  // τ boundary: Δ exactly equal to τ is NOT a candidate (strict >).
  function windowAt(start: number, end: number, cdi: number) {
    return { start, end, cdi };
  }
  const windows = [windowAt(0, 100, 0.0), windowAt(100, 200, 0.5), windowAt(200, 300, 0.25)];

  it('candidate set matches hand computation', () => {
    expect(boundaryCandidates(windows, 0.3)).toEqual([100]);
  });

  it('ΔCDI exactly equal to τ is NOT a candidate', () => {
    // Exactly representable values (Gate 1: 0.3 - 0.1 is 0.19999999999999998
    // in floating point, so the old "equal" case was never equal and the
    // test passed with >= too).
    const equalWindows = [windowAt(0, 100, 0.25), windowAt(100, 200, 0.5)];
    expect(0.5 - 0.25).toBe(0.25);
    expect(boundaryCandidates(equalWindows, 0.25)).toEqual([]);
    expect(boundaryCandidates(equalWindows, 0.24)).toEqual([100]);
  });

  it('window 0 is never a candidate', () => {
    expect(boundaryCandidates([windows[0]!], 0)).toEqual([]);
  });
});

describe('Jev invariant 1: determinism', () => {
  it('same input + cfg → deep-equal output', () => {
    for (const transcript of TRANSCRIPTS) {
      const first = chunkTranscript(transcript, CFG);
      const second = chunkTranscript(transcript, CFG);
      expect(second).toEqual(first);
    }
  });
});

describe('Jev invariant 2: coverage', () => {
  it('chunks are contiguous, cover [0, n), word counts sum to n, words match', () => {
    for (const transcript of TRANSCRIPTS) {
      const words = tokenize(transcript);
      const chunks = chunkTranscript(transcript, CFG);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.startWord).toBe(0);
      expect(chunks[chunks.length - 1]!.endWord).toBe(words.length);
      let sum = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        expect(chunk.index).toBe(i);
        if (i > 0) expect(chunk.startWord).toBe(chunks[i - 1]!.endWord);
        expect(chunk.wordCount).toBe(chunk.endWord - chunk.startWord);
        expect(chunk.text.split(' ')).toEqual(words.filter((unusedWord, position) => position >= chunk.startWord && position < chunk.endWord));
        sum += chunk.wordCount;
      }
      expect(sum).toBe(words.length);
    }
  });
});

describe('Jev invariant 3: bounds', () => {
  it('every chunk <= maxChunkTokens unless the maxChunks merge happened; non-final >= minChunkTokens; short input → 1 chunk', () => {
    let strictChecked = 0;
    for (const transcript of TRANSCRIPTS) {
      const words = tokenize(transcript);
      const chunks = chunkTranscript(transcript, CFG);
      expect(chunks.length).toBeLessThanOrEqual(CFG.maxChunks);
      // The maxChunks merge only runs when there were MORE than maxChunks
      // chunks, and it stops at exactly maxChunks -- so any result with fewer
      // chunks cannot have merged and must obey maxChunkTokens strictly.
      // (Gate 1: the previous check derived "merged" from "some chunk > max",
      // which made the assertion vacuous.)
      const mergeImpossible = chunks.length < CFG.maxChunks;
      if (mergeImpossible) strictChecked++;
      for (let i = 0; i < chunks.length; i++) {
        if (mergeImpossible) {
          expect(chunks[i]!.wordCount).toBeLessThanOrEqual(CFG.maxChunkTokens);
        }
        if (i < chunks.length - 1) {
          expect(chunks[i]!.wordCount).toBeGreaterThanOrEqual(CFG.minChunkTokens);
        }
      }
      if (words.length < CFG.minChunkTokens) {
        expect(chunks).toHaveLength(1);
      }
    }
    // Guard against the assertion going vacuous again.
    expect(strictChecked).toBeGreaterThan(TRANSCRIPTS.length / 2);
  });

  it('input shorter than min → exactly 1 chunk', () => {
    const transcript = 'hello world from the system.';
    expect(tokenize(transcript).length).toBeLessThan(CFG.minChunkTokens);
    expect(chunkTranscript(transcript, CFG)).toHaveLength(1);
  });
});

describe('Jev invariant 4: no sentence split', () => {
  it('non-forced non-final boundaries land right after a word ending .?!', () => {
    for (const transcript of TRANSCRIPTS) {
      const words = tokenize(transcript);
      const chunks = chunkTranscript(transcript, CFG);
      for (let i = 0; i < chunks.length - 1; i++) {
        if (!chunks[i]!.forcedCut) {
          expect(words[chunks[i]!.endWord - 1]).toMatch(/[.?!]$/);
        }
      }
    }
  });
});

describe('Jev invariant 5: degenerate inputs', () => {
  it("'' and whitespace-only → []", () => {
    expect(chunkTranscript('', CFG)).toEqual([]);
    expect(chunkTranscript('   \t\n ', CFG)).toEqual([]);
  });

  it('no candidates (uniform text) → still chunks by size', () => {
    const transcript = Array.from({ length: 20000 }, () => 'alpha').join(' ');
    const chunks = chunkTranscript(transcript, CFG);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(CFG.maxChunks);
    expect(chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0)).toBe(20000);
  });

  it('all-filler text → still chunked; fluffRatio === 1 when every window is fluff', () => {
    const fillerSentence = 'um uh like basically literally actually yeah okay so right';
    const transcript = Array.from({ length: 100 }, () => fillerSentence).join(' ');
    const chunks = chunkTranscript(transcript, CFG);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.fluffRatio).toBe(1);
      expect(chunk.meanCdi).toBeLessThan(CFG.fluffCdiThreshold);
    }
  });
});

describe('Jev invariant 6: monotonic tau', () => {
  it('for τ1 < τ2, candidates(τ2).length <= candidates(τ1).length', () => {
    const tauPairs: Array<[number, number]> = [
      [0.01, 0.05],
      [0.05, 0.08],
      [0.08, 0.2],
      [0.2, 0.5],
    ];
    for (const transcript of TRANSCRIPTS) {
      const words = tokenize(transcript);
      const windows = computeWindows(words, CFG);
      for (const [tau1, tau2] of tauPairs) {
        const small = boundaryCandidates(windows, tau1).length;
        const large = boundaryCandidates(windows, tau2).length;
        expect(large).toBeLessThanOrEqual(small);
      }
    }
  });
});

describe('meanCdi / fluffRatio shape', () => {
  it('dense chunks have higher meanCdi and lower fluffRatio than filler chunks', () => {
    const dense = DENSE_SENTENCES.join(' ').repeat(40);
    const filler = FILLER_SENTENCES.join(' ').repeat(40);
    const denseChunks = chunkTranscript(dense, CFG);
    const fillerChunks = chunkTranscript(filler, CFG);
    const denseMean = denseChunks.reduce((sum, chunk) => sum + chunk.meanCdi, 0) / denseChunks.length;
    const fillerMean = fillerChunks.reduce((sum, chunk) => sum + chunk.meanCdi, 0) / fillerChunks.length;
    expect(denseMean).toBeGreaterThan(fillerMean);
    expect(denseChunks.every((chunk) => chunk.fluffRatio < 0.5)).toBe(true);
  });
});

describe('JevDefaults wiring sanity', () => {
  it('engine cfg equals defaults with empty raw', () => {
    expect(CFG).toEqual(JEV_DEFAULTS);
  });
});

describe('Gate 1 (CC) — cut-selection edge cases', () => {
  const base = resolveJevConfig({
    'analysis.jev.windowWords': 20,
    'analysis.jev.windowStrideWords': 20,
    'analysis.jev.minChunkTokens': 100,
    'analysis.jev.maxChunkTokens': 200,
    'analysis.jev.deltaCdiThreshold': 0.1,
  });
  const filler = (count: number) => Array.from({ length: count }, () => 'um').join(' ');
  const dense = (count: number) => Array.from({ length: count }, (unused, position) => `NASA${position % 10}`).join(' ');

  it('a candidate with no sentence end after it falls back to the last sentence end in range (never a mid-sentence cut)', () => {
    // Sentence end at word 119 (inside [100, 200]); density jump at 160 (candidate);
    // no punctuation between 160 and 200.
    const transcript = [filler(119), 'end.', filler(40), dense(40), filler(300)].join(' ');
    const chunks = chunkTranscript(transcript, base);
    const first = chunks[0]!;
    expect(first.forcedCut).toBe(false);
    expect(first.endWord).toBe(120);
    expect(tokenize(transcript)[first.endWord - 1]!.endsWith('.')).toBe(true);
  });

  it('a short remainder never makes a chunk exceed maxChunkTokens', () => {
    // 250 words, no punctuation: forced cut at 200, remainder 50 < min.
    const chunks = chunkTranscript(filler(250), base);
    for (const chunk of chunks) expect(chunk.wordCount).toBeLessThanOrEqual(200);
    expect(chunks.map((c) => c.wordCount)).toEqual([200, 50]);
  });

  it('a candidate snaps FORWARD to the first sentence end after it (not the last one in range, not the raw candidate)', () => {
    // Candidate at 180 (dense 160..170 then filler); sentence ends at 185 and 195.
    // snap → 186; last-sentence-end fallback would give 196; raw candidate 180.
    const words = [
      ...Array.from({ length: 160 }, () => 'um'),
      ...Array.from({ length: 10 }, (unused, position) => `NASA${position}`),
      ...Array.from({ length: 15 }, () => 'um'),
      'stop.',
      ...Array.from({ length: 9 }, () => 'um'),
      'again.',
      ...Array.from({ length: 300 }, () => 'um'),
    ];
    const transcript = words.join(' ');
    expect(boundaryCandidates(computeWindows(tokenize(transcript), base), base.deltaCdiThreshold)).toContain(180);
    const first = chunkTranscript(transcript, base)[0]!;
    expect(first.endWord).toBe(186);
    expect(first.forcedCut).toBe(false);
  });
});
