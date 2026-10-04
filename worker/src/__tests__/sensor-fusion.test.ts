import { describe, expect, it, vi } from 'vitest';
import { calculateProbeTimestamps, PROBE_CHUNK_SECONDS, PROBE_MAX_SAMPLES } from '../services/sensor-fusion/probes/sampler';
import {
  handleProbeJob,
  ProbeRetryableError,
  type ProbeJobState,
  type ProbeJobStatus,
  type ProbeJobStore,
} from '../services/sensor-fusion/probes/probe-orchestrator';
import {
  countTurnMarkers,
  JEV_TEXT_CHUNK_CHARS,
  JevTextParser,
  parseJevTextScores,
  splitTranscript,
} from '../services/sensor-fusion/heuristics/jev-text-parser';
import { routeFusion, type FusionInput } from '../services/sensor-fusion/matrix/fusion-router';

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
  it('returns a single chunk at 0 below 16s, skipping safe-zone math', () => {
    expect(calculateProbeTimestamps(10)).toEqual([0]);
    expect(calculateProbeTimestamps(15)).toEqual([0]);
  });
  it('never emits duplicate starts just above the short-clip bound', () => {
    const starts = calculateProbeTimestamps(16);
    expect(new Set(starts).size).toBe(starts.length);
    expect(starts.length).toBeGreaterThan(0);
  });
  it('caps at 15 samples for multi-hour videos, all inside the safe zone', () => {
    const duration = 36000;
    const starts = calculateProbeTimestamps(duration);
    expect(starts).toHaveLength(PROBE_MAX_SAMPLES);
    expect(starts[0]).toBeGreaterThanOrEqual(duration * 0.03);
    expect((starts[starts.length - 1] as number) + PROBE_CHUNK_SECONDS).toBeLessThanOrEqual(duration * 0.97 + 1e-6);
  });
  it('gives 3 evenly spaced starts at 600s', () => {
    const starts = calculateProbeTimestamps(600);
    expect(starts).toHaveLength(3);
    expect((starts[1] as number) - (starts[0] as number)).toBeCloseTo((starts[2] as number) - (starts[1] as number), 3);
  });
});

/** In-memory ProbeJobStore with compare-and-set semantics matching the port contract. */
const createStore = () => {
  let current: ProbeJobState | null = null;
  let leases = 0;
  const store: ProbeJobStore = {
    acquire: (jobId) => {
      if (current && (current.state === 'processing' || current.state === 'succeeded')) return Promise.resolve(null);
      leases += 1;
      current = { job_id: jobId, state: 'processing', generation: current?.generation ?? 0, lease_token: `lease-${leases}` };
      return Promise.resolve({ ...current });
    },
    transition: (expected, next) => {
      if (!current || current.generation !== expected.generation || current.lease_token !== expected.lease_token) {
        return Promise.resolve(null);
      }
      current = { ...current, state: next.state, generation: next.generation };
      return Promise.resolve({ ...current });
    },
  };
  return {
    store,
    get: () => current,
    /** Simulates another worker superseding the lease while this one is still running. */
    supersede: (state: ProbeJobStatus) => {
      if (current) current = { ...current, state, generation: current.generation + 1, lease_token: 'other' };
    },
  };
};

describe('handleProbeJob', () => {
  const payload = { videoId: 'abc', videoUrl: 'u', timestamps: [1] };
  const metadata = { visual_ui_detected: true };

  it('deletes the R2 object only after the succeeded transition commits', async () => {
    const fake = createStore();
    const del = vi.fn().mockResolvedValue();
    const outcome = await handleProbeJob(payload, {
      store: fake.store,
      bucket: { delete: del },
      processAv: () => Promise.resolve(metadata),
      writeMetadata: vi.fn().mockResolvedValue(),
    });
    expect(outcome).toBe('succeeded');
    expect(fake.get()?.state).toBe('succeeded');
    expect(del).toHaveBeenCalledOnce();
    expect(del).toHaveBeenCalledWith('probes/abc');
  });

  it('keeps the artifact on a transient A/V failure and moves to retry_wait with generation + 1', async () => {
    const fake = createStore();
    const del = vi.fn().mockResolvedValue();
    await expect(
      handleProbeJob(payload, {
        store: fake.store,
        bucket: { delete: del },
        processAv: () => Promise.reject(new ProbeRetryableError('av down')),
        writeMetadata: vi.fn(),
      }),
    ).rejects.toThrow('av down');
    expect(del).not.toHaveBeenCalled();
    expect(fake.get()).toMatchObject({ state: 'retry_wait', generation: 1 });
  });

  it('keeps the artifact on a transient DB write failure', async () => {
    const fake = createStore();
    const del = vi.fn().mockResolvedValue();
    await expect(
      handleProbeJob(payload, {
        store: fake.store,
        bucket: { delete: del },
        processAv: () => Promise.resolve(metadata),
        writeMetadata: () => Promise.reject(new ProbeRetryableError('db timeout')),
      }),
    ).rejects.toThrow('db timeout');
    expect(del).not.toHaveBeenCalled();
    expect(fake.get()?.state).toBe('retry_wait');
  });

  it('retry after retry_wait re-acquires at the bumped generation and can then delete', async () => {
    const fake = createStore();
    const del = vi.fn().mockResolvedValue();
    const deps = (processAv: () => Promise<typeof metadata>) => ({
      store: fake.store,
      bucket: { delete: del },
      processAv,
      writeMetadata: vi.fn().mockResolvedValue(),
    });
    await expect(handleProbeJob(payload, deps(() => Promise.reject(new ProbeRetryableError('x'))))).rejects.toThrow();
    expect(await handleProbeJob(payload, deps(() => Promise.resolve(metadata)))).toBe('succeeded');
    expect(fake.get()).toMatchObject({ state: 'succeeded', generation: 1 });
    expect(del).toHaveBeenCalledOnce();
  });

  it('a stale lease cannot delete: superseded mid-run, success transition is rejected', async () => {
    const fake = createStore();
    const del = vi.fn().mockResolvedValue();
    const outcome = await handleProbeJob(payload, {
      store: fake.store,
      bucket: { delete: del },
      processAv: () => {
        fake.supersede('processing');
        return Promise.resolve(metadata);
      },
      writeMetadata: vi.fn().mockResolvedValue(),
    });
    expect(outcome).toBe('stale_lease');
    expect(del).not.toHaveBeenCalled();
    expect(fake.get()?.lease_token).toBe('other');
  });

  it('a stale lease that fails does not overwrite the newer state', async () => {
    const fake = createStore();
    await expect(
      handleProbeJob(payload, {
        store: fake.store,
        bucket: { delete: vi.fn() },
        processAv: () => {
          fake.supersede('processing');
          return Promise.reject(new ProbeRetryableError('late'));
        },
        writeMetadata: vi.fn(),
      }),
    ).resolves.toBe('stale_lease');
    expect(fake.get()).toMatchObject({ state: 'processing', lease_token: 'other' });
  });

  it('non-retryable failure moves to failed and keeps the artifact for the TTL', async () => {
    const fake = createStore();
    const del = vi.fn();
    const outcome = await handleProbeJob(payload, {
      store: fake.store,
      bucket: { delete: del },
      processAv: () => Promise.reject(new Error('corrupt media')),
      writeMetadata: vi.fn(),
    });
    expect(outcome).toBe('failed');
    expect(fake.get()?.state).toBe('failed');
    expect(del).not.toHaveBeenCalled();
  });

  it('skips without processing when the job is already held', async () => {
    const fake = createStore();
    await fake.store.acquire('probe:abc');
    const processAv = vi.fn();
    const outcome = await handleProbeJob(payload, {
      store: fake.store,
      bucket: { delete: vi.fn() },
      processAv,
      writeMetadata: vi.fn(),
    });
    expect(outcome).toBe('skipped');
    expect(processAv).not.toHaveBeenCalled();
  });

  it('a failed delete after commit is reported but does not change the outcome', async () => {
    const fake = createStore();
    const outcome = await handleProbeJob(payload, {
      store: fake.store,
      bucket: { delete: vi.fn().mockRejectedValue(new Error('r2 down')) },
      processAv: () => Promise.resolve(metadata),
      writeMetadata: vi.fn().mockResolvedValue(),
    });
    expect(outcome).toBe('succeeded');
  });
});

describe('jev text parser', () => {
  const score = (value: number) => ({ type: 'score', score: value });
  const answers = (direct: number, procedural: number, fluff: number) => ({
    answers: {
      direct_address_intensity: score(direct),
      procedural_instruction_intensity: score(procedural),
      tangential_fluff_intensity: score(fluff),
    },
  });

  it('counts literal >> markers', () => expect(countTurnMarkers('>> a >> b >>')).toBe(3));
  it('rejects out-of-range and non-numeric scores', () => {
    expect(parseJevTextScores(answers(2, 0, 3)).direct_address_intensity).toBe(2);
    expect(() => parseJevTextScores(answers(4, 0, 0))).toThrow();
    expect(() => parseJevTextScores(answers(-1, 0, 0))).toThrow();
    expect(() =>
      parseJevTextScores({ answers: { direct_address_intensity: { type: 'score', score: Number.NaN }, procedural_instruction_intensity: score(0), tangential_fluff_intensity: score(0) } }),
    ).toThrow();
  });
  it('rounds float scores to integers', () => {
    expect(parseJevTextScores(answers(1.5, 0.4, 2.6))).toEqual({
      direct_address_intensity: 2,
      procedural_instruction_intensity: 0,
      tangential_fluff_intensity: 3,
    });
  });
  it('splits into 8,000-character blocks covering the whole transcript', () => {
    const transcript = 'x'.repeat(JEV_TEXT_CHUNK_CHARS * 2 + 10);
    const blocks = splitTranscript(transcript);
    expect(blocks.map((block) => block.length)).toEqual([JEV_TEXT_CHUNK_CHARS, JEV_TEXT_CHUNK_CHARS, 10]);
    expect(blocks.join('')).toBe(transcript);
    expect(splitTranscript('   ')).toEqual([]);
  });
  it('scores every block and averages to integers, counting >> over the full transcript', async () => {
    const responses = [answers(3, 0, 1), answers(1, 2, 1), answers(2, 1, 1)];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve(responses.shift()) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const transcript = `>> ${'a'.repeat(JEV_TEXT_CHUNK_CHARS)}>> ${'b'.repeat(JEV_TEXT_CHUNK_CHARS)}>> tail`;
      const result = await new JevTextParser('key').analyze(transcript);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        direct_address_intensity: 2,
        procedural_instruction_intensity: 1,
        tangential_fluff_intensity: 1,
        turn_marker_count: 3,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('fails the whole analysis if any block fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(answers(1, 1, 1)) })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(new JevTextParser('key').analyze('a'.repeat(JEV_TEXT_CHUNK_CHARS + 5))).rejects.toThrow('500');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('rejects an empty transcript', async () => {
    await expect(new JevTextParser('key').analyze('  ')).rejects.toThrow('empty');
  });
});

describe('routeFusion', () => {
  const base: FusionInput = {
    turnMarkerCount: 0,
    diarizationSpeakerCount: 1,
    uiFramesDetected: false,
    debateProsodyDetected: false,
    directAddressIntensity: 0,
    proceduralInstructionIntensity: 0,
    tangentialFluffIntensity: 0,
  };
  const route = (overrides: Partial<FusionInput>) => routeFusion({ ...base, ...overrides });

  it('hard override: UI frames always route S4, even against a monologue pre-rule', () => {
    expect(route({ uiFramesDetected: true })).toEqual({ route: 'S4', confidence: 0.95 });
    expect(route({ uiFramesDetected: true, diarizationSpeakerCount: 3, debateProsodyDetected: true }).route).toBe('S4');
  });
  it('pre-rule: one speaker and fewer than 5 turn markers routes S1', () => {
    expect(route({ turnMarkerCount: 4 }).route).toBe('S1');
    expect(route({ turnMarkerCount: 0 }).confidence).toBe(0.85);
  });
  it('vlog guard: a single-speaker clip with high direct address or fluff is not claimed by the S1 pre-rule', () => {
    expect(route({ directAddressIntensity: 3, tangentialFluffIntensity: 2 }).route).toBe('S6');
    expect(route({ tangentialFluffIntensity: 2, directAddressIntensity: 2 }).route).toBe('S6');
  });
  it('pre-rules: panel and interview', () => {
    expect(route({ diarizationSpeakerCount: 4, debateProsodyDetected: true, turnMarkerCount: 30 }).route).toBe('S3');
    expect(route({ diarizationSpeakerCount: 2, turnMarkerCount: 20 }).route).toBe('S2');
  });
  it('weighted: procedural intensity without UI frames routes S4', () => {
    expect(route({ proceduralInstructionIntensity: 3, turnMarkerCount: 6 }).route).toBe('S4');
  });
  it('weighted: multi-speaker debate with few speakers routes S3', () => {
    expect(route({ diarizationSpeakerCount: 2, debateProsodyDetected: true, turnMarkerCount: 12 }).route).toBe('S3');
  });
  it('weighted: many-turn single speaker with low signals falls through to a valid route with confidence in (0, 1]', () => {
    const result = route({ turnMarkerCount: 8 });
    expect(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']).toContain(result.route);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
  it('is deterministic', () => {
    const input = { ...base, turnMarkerCount: 9, directAddressIntensity: 1 };
    expect(routeFusion(input)).toEqual(routeFusion({ ...input }));
  });
  it('rejects invalid input', () => {
    expect(() => route({ directAddressIntensity: 1.5 })).toThrow(RangeError);
    expect(() => route({ tangentialFluffIntensity: 4 })).toThrow(RangeError);
    expect(() => route({ turnMarkerCount: -1 })).toThrow(RangeError);
    expect(() => route({ diarizationSpeakerCount: 1.2 })).toThrow(RangeError);
  });
});
