import { describe, expect, it } from 'vitest';
import { JEV_DEFAULTS } from '@/lib/config/jev';
import { planAnalysis, type PlanAnalysisInput } from '@/lib/usecases/PlanAnalysisUseCase';

const BASE: Omit<PlanAnalysisInput, 'transcript'> = {
  jevConfig: JEV_DEFAULTS,
  bundles: [
    [1, 10],
    [2, 4, 6],
    [5, 7],
    [3, 8],
    [9, 11],
  ],
  transcriptBudgetChars: 48_000,
  costCapCents: Number.POSITIVE_INFINITY,
  inputUsdPerMTok: 1.5,
  outputUsdPerMTok: 7.5,
  promptPrefixTokens: 1_000,
  maxOutputTokens: 8_192,
};

/** Long transcript (>48k chars) of varied words with sentence ends. */
function longTranscript(sentences: number): string {
  const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
  const parts: string[] = [];
  for (let i = 0; i < sentences; i++) {
    const w = words[i % words.length]!;
    parts.push(`${w} ${w}${i} explains ${w} concepts about ${w} systems and ${w} analysis.`);
  }
  return parts.join(' ');
}

describe('planAnalysis', () => {
  it('K=1 when Jev disabled: 5 streams, one segment per bundle, projective same segment', async () => {
    const plan = await planAnalysis({ ...BASE, transcript: 'short transcript text here' });
    expect(plan.K).toBe(1);
    expect(plan.streamCount).toBe(5);
    expect(plan.truncatedFallback).toBe(false);
    expect(plan.cells).toHaveLength(5);
    for (const cell of plan.cells) {
      expect(cell.jevChunkIndex).toBe(0);
      expect(cell.startWord).toBe(0);
      expect(cell.endWord).toBe(4);
    }
    const grounded = plan.cells.filter((_unusedCell, idx) => idx < 4);
    const projective = plan.cells.filter((_unusedCell, idx) => idx >= 4);
    expect(new Set(grounded.map((c) => c.sha256))).toHaveLength(1);
    expect(new Set(projective.map((c) => c.sha256))).toHaveLength(1);
    expect(new Set(grounded.map((c) => c.chunkIndex))).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(projective.map((c) => c.chunkIndex))).toEqual(new Set([5]));  });

  it('K=1 regression: disabled Jev segment covers whole transcript', async () => {
    const transcriptText = 'one two three four five six';
    const plan = await planAnalysis({ ...BASE, transcript: transcriptText });
    expect(plan.cells.every((c) => c.endWord === 6)).toBe(true);
  });

  it('K>1 when enabled and over char budget: streamCount = K*G + P', async () => {
    const plan = await planAnalysis({ ...BASE, transcript: longTranscript(900), jevConfig: { ...JEV_DEFAULTS, enabled: true } });
    expect(plan.K).toBeGreaterThan(1);
    const groundedCount = 4;
    const projectiveCount = 1;
    expect(plan.streamCount).toBe(plan.K * groundedCount + projectiveCount);
    // one projective cell, at chunk 0
    const proj = plan.cells.filter((c) => c.chunkIndex === 5);
    expect(proj).toHaveLength(1);
    const projectiveCell = proj[0];
    if (!projectiveCell) throw new Error('missing projective cell');
    expect(projectiveCell.jevChunkIndex).toBe(0);
    expect(projectiveCell.startWord).toBe(0);
    expect(projectiveCell.endWord).toBe(0);
    // grounded cells: K chunks x 4 bundles, each chunk's 4 share one triple
    const grounded = plan.cells.filter((c) => c.chunkIndex !== 5);
    expect(grounded).toHaveLength(plan.K * groundedCount);
    for (let k = 0; k < plan.K; k++) {
      const chunkCells = grounded.filter((c) => c.jevChunkIndex === k);
      expect(chunkCells).toHaveLength(groundedCount);
      expect(new Set(chunkCells.map((c) => c.sha256))).toHaveLength(1);
      expect(new Set(chunkCells.map((c) => c.startWord))).toHaveLength(1);
    }
  });

  it('cost cap merges smallest adjacent chunks until estimate fits', async () => {
    const unconstrained = await planAnalysis({ ...BASE, transcript: longTranscript(900), jevConfig: { ...JEV_DEFAULTS, enabled: true } });
    // Cap set just below the unconstrained estimate forces at least one merge.
    const cap = Math.max(1, Math.floor(unconstrained.estimateCents) - 1);
    const capped = await planAnalysis({
      ...BASE,
      transcript: longTranscript(900),
      jevConfig: { ...JEV_DEFAULTS, enabled: true },
      costCapCents: cap,
    });
    expect(capped.estimateCents).toBeLessThanOrEqual(cap);
    expect(capped.K).toBeLessThan(unconstrained.K);
    expect(capped.K).toBeGreaterThanOrEqual(1);
    expect(capped.truncatedFallback).toBe(false);
  });

  it('cost cap unreachable even at K=1: truncatedFallback=true', async () => {
    const plan = await planAnalysis({
      ...BASE,
      transcript: longTranscript(900),
      jevConfig: { ...JEV_DEFAULTS, enabled: true },
      costCapCents: 0,
    });
    expect(plan.K).toBe(1);
    expect(plan.truncatedFallback).toBe(true);
    expect(plan.estimateCents).toBeGreaterThan(0);
  });

  it('cells segments are contiguous, ordered, and tile the transcript', async () => {
    const plan = await planAnalysis({ ...BASE, transcript: longTranscript(900), jevConfig: { ...JEV_DEFAULTS, enabled: true } });
    const perChunk = new Map<number, { start: number; end: number }>();
    for (const c of plan.cells) {
      if (c.chunkIndex === 5) continue;
      const prev = perChunk.get(c.jevChunkIndex);
      if (prev) {
        expect(c.startWord).toBe(prev.start);
        expect(c.endWord).toBe(prev.end);
      } else {
        perChunk.set(c.jevChunkIndex, { start: c.startWord, end: c.endWord });
      }
    }
    const ordered = [...perChunk.entries()].sort((first, second) => first[0] - second[0]);
    const firstEntry = ordered[0];
    if (!firstEntry) throw new Error('missing first chunk entry');
    expect(firstEntry[1].start).toBe(0);
    for (let i = 1; i < ordered.length; i++) {
      const current = ordered[i];
      const previous = ordered[i - 1];
      if (!current || !previous) throw new Error('missing chunk entry');
      expect(current[1].start).toBe(previous[1].end);
    }
    const lastEntry = ordered[ordered.length - 1];
    if (!lastEntry) throw new Error('missing last chunk entry');
    const last = lastEntry[1].end;
    const totalWords = longTranscript(900).split(/\s+/).filter(Boolean).length;
    expect(last).toBe(totalWords);
  });
});
