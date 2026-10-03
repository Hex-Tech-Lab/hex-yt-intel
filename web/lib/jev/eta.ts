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

export interface EtaState {
  remainingMs: number;
  at: number;
}

/** Countdown since the last shown value, blended toward the raw estimate. alpha in (0,1]. */
export function smoothEta(
  prev: EtaState | null,
  rawMs: number | null,
  now: number,
  alpha = 0.2
): EtaState | null {
  const safeAlpha = typeof alpha === 'number' && !Number.isNaN(alpha) && alpha > 0 && alpha <= 1 ? alpha : 0.2;

  if (rawMs === null && prev === null) return null;
  if (prev === null) {
    if (rawMs === null) return null;
    return { remainingMs: rawMs, at: now };
  }

  const elapsed = Math.max(0, now - prev.at);
  const countdown = Math.max(0, prev.remainingMs - elapsed);

  if (rawMs === null) {
    return { remainingMs: countdown, at: now };
  }

  if (countdown === 0 || Math.abs(rawMs - countdown) >= Math.max(10_000, 0.5 * countdown)) {
    return { remainingMs: rawMs, at: now };
  }

  return {
    remainingMs: Math.round(safeAlpha * rawMs + (1 - safeAlpha) * countdown),
    at: now,
  };
}
