/**
 * R3b 2.5e: live ETA for a K>1 run, from cell completion so far.
 * Pure. Returns null until at least one cell has settled (no rate yet) and
 * once every cell has settled.
 */
export function estimateRemainingMs(run: { total: number; settled: number; startedAt: number }, now: number): number | null {
  if (run.settled <= 0 || run.settled >= run.total) return null;
  const perCellMs = Math.max(0, now - run.startedAt) / run.settled;
  return Math.round(perCellMs * (run.total - run.settled));
}

/** "ETA: 14s" / "ETA: 2m 05s" / "Estimating…" for the locked detail panel. */
export function formatEta(remainingMs: number | null): string {
  if (remainingMs === null) return 'Estimating…';
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  if (totalSeconds < 60) return `ETA: ${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `ETA: ${minutes}m ${seconds}s`;
}
