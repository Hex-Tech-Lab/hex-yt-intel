import { describe, expect, it, vi } from 'vitest';
import { calculateProbeTimestamps, PROBE_CHUNK_SECONDS } from '../services/sensor-fusion/probes/sampler';
import { handleProbeJob } from '../services/sensor-fusion/probes/probe-orchestrator';
import { countTurnMarkers, parseJevTextScores } from '../services/sensor-fusion/heuristics/jev-text-parser';

describe('calculateProbeTimestamps', () => {
  it('uses the 3-sample floor for short videos', () => {
    expect(calculateProbeTimestamps(600)).toHaveLength(3);
  });
  it('scales as ceil(minutes/12)', () => {
    expect(calculateProbeTimestamps(64 * 60)).toHaveLength(6);
    expect(calculateProbeTimestamps(36 * 60)).toHaveLength(3);
    expect(calculateProbeTimestamps(37 * 60)).toHaveLength(4);
  });
  it('keeps every chunk inside the 3% safe zone, ascending', () => {
    const duration = 3600;
    const starts = calculateProbeTimestamps(duration);
    expect(starts).toEqual([...starts].sort((first, second) => first - second));
    for (const start of starts) {
      expect(start).toBeGreaterThanOrEqual(duration * 0.03);
      expect(start + PROBE_CHUNK_SECONDS).toBeLessThanOrEqual(duration * 0.97 + 1e-6);
    }
  });
  it('rejects invalid durations', () => {
    expect(calculateProbeTimestamps(0)).toEqual([]);
    expect(calculateProbeTimestamps(NaN)).toEqual([]);
  });
});

describe('handleProbeJob', () => {
  const payload = { videoId: 'abc', videoUrl: 'u', timestamps: [1] };
  it('deletes the R2 object after success', async () => {
    const del = vi.fn().mockResolvedValue();
    const write = vi.fn().mockResolvedValue();
    await handleProbeJob(payload, { bucket: { delete: del }, processAv: () => Promise.resolve({ visual_ui_detected: true }), writeMetadata: write });
    expect(write).toHaveBeenCalledWith('abc', { visual_ui_detected: true });
    expect(del).toHaveBeenCalledWith('probes/abc');
  });
  it('still deletes on failure and surfaces the original error', async () => {
    const del = vi.fn().mockRejectedValue(new Error('r2 down'));
    await expect(
      handleProbeJob(payload, { bucket: { delete: del }, processAv: () => Promise.reject(new Error('av')), writeMetadata: vi.fn() }),
    ).rejects.toThrow('av');
    expect(del).toHaveBeenCalled();
  });
});

describe('jev text parser', () => {
  it('counts literal >> markers', () => expect(countTurnMarkers('>> a >> b >>')).toBe(3));
  it('rejects out-of-range scores', () => {
    const ok = { type: 'score', score: 2 };
    expect(parseJevTextScores({ answers: { direct_address_intensity: ok, procedural_instruction_intensity: ok, tangential_fluff_intensity: ok } }).direct_address_intensity).toBe(2);
    expect(() => parseJevTextScores({ answers: { direct_address_intensity: { type: 'score', score: 4 }, procedural_instruction_intensity: ok, tangential_fluff_intensity: ok } })).toThrow();
  });
});
