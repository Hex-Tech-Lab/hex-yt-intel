/**
 * Dynamic duration-based probe sampling (ADR 039 §1.3).
 *
 * N_samples = max(3, ceil(durationMinutes / 12)). The first and last 3% of the
 * video are excluded (safe zone). The safe zone is split into N equal bins and
 * one chunk is centred in each bin, then clamped so the whole chunk stays
 * inside the safe zone.
 */

export const PROBE_CHUNK_SECONDS = 15;
export const PROBE_MIN_SAMPLES = 3;
export const PROBE_MINUTES_PER_SAMPLE = 12;
export const PROBE_EDGE_EXCLUSION = 0.03;

export function calculateProbeTimestamps(durationSeconds: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];

  const sampleCount = Math.max(
    PROBE_MIN_SAMPLES,
    Math.ceil(durationSeconds / 60 / PROBE_MINUTES_PER_SAMPLE),
  );

  const safeStart = durationSeconds * PROBE_EDGE_EXCLUSION;
  const safeEnd = durationSeconds * (1 - PROBE_EDGE_EXCLUSION);
  const binWidth = (safeEnd - safeStart) / sampleCount;
  const latestStart = Math.max(safeStart, safeEnd - PROBE_CHUNK_SECONDS);

  return Array.from({ length: sampleCount }, (_, i) => {
    const centre = safeStart + binWidth * (i + 0.5);
    const start = Math.min(Math.max(centre - PROBE_CHUNK_SECONDS / 2, safeStart), latestStart);
    return Math.round(start * 1000) / 1000;
  });
}
