const DEFAULT_MAX_SCORE = 10;

/**
 * Clamps a score/maxScore pair for SignalBarGroup's visual ratio and ARIA
 * attributes. Extracted to its own .ts file (not inside SignalBarGroup.tsx)
 * so it can be unit-tested without triggering the pre-existing vitest/esbuild
 * JSX-transform failure when a .ts test imports a .tsx file containing real
 * JSX (same pattern as web/lib/utils/currency.ts, established earlier this
 * session) -- this repo's test suite also has no jsdom/happy-dom dependency,
 * so a DOM-based component test wasn't an option either way.
 */
export function clampSignalScore(score: number, maxScore: number): { normalizedScore: number; normalizedMaxScore: number } {
  const normalizedMaxScore = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : DEFAULT_MAX_SCORE;
  const normalizedScore = Number.isFinite(score)
    ? Math.max(0, Math.min(normalizedMaxScore, score))
    : 0;
  return { normalizedScore, normalizedMaxScore };
}
