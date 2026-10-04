/**
 * Dynamic duration-based probe sampling (ADR 039 §1.3).
 *
 * N_samples = clamp(ceil(durationMinutes / 12), 3, 15). The first and last 3%
 * of the video are excluded (safe zone). The safe zone is split into N equal
 * bins and one chunk is centred in each bin, then clamped so the whole chunk
 * stays inside the safe zone. Clips too short for a full chunk return a single
 * chunk at 0 and skip the safe-zone math.
 */

export const PROBE_CHUNK_SECONDS = 15;
export const PROBE_MIN_SAMPLES = 3;
export const PROBE_MAX_SAMPLES = 15;
export const PROBE_MINUTES_PER_SAMPLE = 12;
export const PROBE_EDGE_EXCLUSION = 0.03;
export const PROBE_SHORT_CLIP_SECONDS = 16;

/** Sample count for a video: ceil(minutes / 12), clamped to [3, 15]. */
const sampleCountFor = (durationSeconds: number): number =>
  Math.min(PROBE_MAX_SAMPLES, Math.max(PROBE_MIN_SAMPLES, Math.ceil(durationSeconds / 60 / PROBE_MINUTES_PER_SAMPLE)));

/** Start of the chunk centred in bin `index` of the safe zone, clamped so the whole chunk stays inside it. */
const chunkStart = (index: number, sampleCount: number, durationSeconds: number): number => {
  const safeStart = durationSeconds * PROBE_EDGE_EXCLUSION;
  const safeEnd = durationSeconds * (1 - PROBE_EDGE_EXCLUSION);
  const binWidth = (safeEnd - safeStart) / sampleCount;
  const latestStart = Math.max(safeStart, safeEnd - PROBE_CHUNK_SECONDS);
  const centre = safeStart + binWidth * (index + 0.5);
  const start = Math.min(Math.max(centre - PROBE_CHUNK_SECONDS / 2, safeStart), latestStart);
  return Math.round(start * 1000) / 1000;
};

/** Returns start times (seconds) of the 15s probe chunks for a video of the given duration; [] for invalid input. */
export const calculateProbeTimestamps = (durationSeconds: number): number[] => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  if (durationSeconds < PROBE_SHORT_CLIP_SECONDS) return [0];

  const sampleCount = sampleCountFor(durationSeconds);
  const starts = Array.from({ length: sampleCount }, (slot, index) => chunkStart(index, sampleCount, durationSeconds));
  // Clips only a little over one chunk long clamp several bins onto one start.
  return starts.filter((start, index) => index === 0 || start !== starts[index - 1]);
};
