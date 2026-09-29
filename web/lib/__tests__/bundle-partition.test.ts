/**
 * R1a (2026-09-29): bundle map single source of truth.
 *
 * Contract: `analysis.streamBundles` (Settings Registry, type json) is the ONE
 * authority for the 5-stream dimension partition. CreateAnalysisUseCase
 * resolves it, enforces assertBundlePartition (exactly 5 bundles, dims 1..11
 * each exactly once, no 0/duplicates) and falls back to the code constant
 * STREAM_BUNDLES with a Sentry error when the registry value is invalid.
 * The code constant itself must pass the invariant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STREAM_BUNDLES, assertBundlePartition } from '@/lib/config/synthesis';
import { CreateAnalysisUseCase } from '@/lib/usecases/CreateAnalysisUseCase';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import type { MetadataIngestionPort, AnalysisPersistencePort, BillingQuotaPort, ModelResolutionPort, CryptographicTokenPort, CommentSamplingPort } from '@/lib/ports';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

describe('assertBundlePartition', () => {
  it('accepts the target map (the code constant itself)', () => {
    expect(() => assertBundlePartition(STREAM_BUNDLES)).not.toThrow();
    expect(STREAM_BUNDLES).toEqual([[1, 10], [2, 4, 6], [5, 7], [3, 8], [9, 11]]);
  });

  it('rejects a duplicate dimension', () => {
    expect(() => assertBundlePartition([[1, 10], [2, 4, 6], [5, 7], [3, 8], [9, 10]]))
      .toThrow(/dimension 10 appears more than once/);
  });

  it('rejects a missing dimension', () => {
    expect(() => assertBundlePartition([[1, 10], [2, 4, 6], [5, 7], [3], [9, 11]]))
      .toThrow(/dimension 8 is missing/);
  });

  it('rejects a 6-bundle map', () => {
    expect(() => assertBundlePartition([[1], [2], [3], [4], [5], [6, 7, 8, 9, 10, 11]]))
      .toThrow(/expected exactly 5 bundles, got 6/);
  });

  it('rejects a non-array registry value with a precise message', () => {
    expect(() => assertBundlePartition({ bundles: [] } as unknown as number[][])).toThrow(/expected an array of dimension arrays/);
    expect(() => assertBundlePartition([[1, 10], 'x'] as unknown as number[][])).toThrow(/expected an array of dimension arrays/);
  });

  it('rejects complete, unique partitions that MIX grounded and projective dims (#363 review P2)', () => {
    expect(() => assertBundlePartition([[1, 9], [2, 4, 6], [5, 7], [3, 8], [10, 11]])).toThrow(/mixes grounded and projective/);
    expect(() => assertBundlePartition([[1, 10], [2, 4, 6], [5, 7], [3], [8, 9, 11]])).toThrow(/mixes grounded and projective/);
  });

  it('rejects dimension 0', () => {
    expect(() => assertBundlePartition([[0, 1], [2, 4, 6], [5, 7], [3, 8], [9, 10, 11]]))
      .toThrow(/outside the valid range/);
  });
});

const ports = {
  metadataIngestion: {
    fetch: vi.fn().mockResolvedValue({
      metadata: { title: 'T', channelTitle: 'C' },
      transcript: 'x',
      transcriptAvailable: true,
    }),
    detectPersona: vi.fn().mockReturnValue('creator'),
    buildJobMetadata: vi.fn().mockReturnValue({}),
  },
  persistence: {
    findCachedAnalysis: vi.fn().mockResolvedValue(null),
    upsertProcessingStub: vi.fn().mockResolvedValue({ id: 'stub-1' }),
  },
  billingQuota: { checkGate: vi.fn().mockResolvedValue({ allowed: true, headers: {} }) },
  modelResolution: { resolveModels: vi.fn().mockResolvedValue(['m1']) },
  tokenCrypto: { signAnalysisToken: vi.fn().mockResolvedValue({ sig: 's', exp: 1 }) },
  commentSampling: { planSample: vi.fn() },
} as unknown as {
  metadataIngestion: MetadataIngestionPort;
  persistence: AnalysisPersistencePort;
  billingQuota: BillingQuotaPort;
  modelResolution: ModelResolutionPort;
  tokenCrypto: CryptographicTokenPort;
  commentSampling: CommentSamplingPort;
};

function buildUseCase() {
  return new CreateAnalysisUseCase(
    ports.metadataIngestion,
    ports.persistence,
    ports.billingQuota,
    ports.modelResolution,
    ports.tokenCrypto,
    ports.commentSampling
  );
}

const params = {
  url: 'https://www.youtube.com/watch?v=abc123',
  userId: 'u1',
  tier: 'free' as const,
  timezone: 'UTC',
};

describe('CreateAnalysisUseCase streamBundles (R1a)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    SupabaseSettingsAdapter.clearRegistryCacheForTests?.();
  });

  it('returns the registry value in the job when it passes the invariant (E2E: registry → job.streamBundles)', async () => {
    vi.spyOn(SupabaseSettingsAdapter, 'getRegistrySettings').mockImplementation(
      (keys, fallback) => {
        const out = { ...fallback };
        if (keys.includes('analysis.streamBundles')) {
          out['analysis.streamBundles' as keyof typeof out] = [[1, 10], [2, 4, 6], [5, 7], [3, 8], [9, 11]];
        }
        return Promise.resolve(out as typeof fallback);
      }
    );
    const result = await buildUseCase().execute(params);
    expect(result.type).toBe('processing');
    if (result.type !== 'processing') throw new Error('expected processing');
    expect(result.data.streamBundles).toEqual([[1, 10], [2, 4, 6], [5, 7], [3, 8], [9, 11]]);
  });

  it('falls back to the code constant (with Sentry) when the registry value violates the invariant', async () => {
    vi.spyOn(SupabaseSettingsAdapter, 'getRegistrySettings').mockImplementation(
      (keys, fallback) => {
        const out = { ...fallback };
        if (keys.includes('analysis.streamBundles')) {
          // Duplicate dim 10 + missing dim 9: invalid partition.
          out['analysis.streamBundles' as keyof typeof out] = [[1, 10], [2, 4, 6], [5, 7], [3, 8], [10, 11]];
        }
        return Promise.resolve(out as typeof fallback);
      }
    );
    const result = await buildUseCase().execute(params);
    expect(result.type).toBe('processing');
    if (result.type !== 'processing') throw new Error('expected processing');
    expect(result.data.streamBundles).toEqual(STREAM_BUNDLES);
    const { captureException } = await import('@sentry/nextjs');
    expect(captureException).toHaveBeenCalled();
  });

  it('falls back to the code constant when the registry value is not an array', async () => {
    vi.spyOn(SupabaseSettingsAdapter, 'getRegistrySettings').mockImplementation(
      (keys, fallback) => {
        const out = { ...fallback };
        if (keys.includes('analysis.streamBundles')) {
          out['analysis.streamBundles' as keyof typeof out] = 'garbage';
        }
        return Promise.resolve(out as typeof fallback);
      }
    );
    const result = await buildUseCase().execute(params);
    expect(result.type).toBe('processing');
    if (result.type !== 'processing') throw new Error('expected processing');
    expect(result.data.streamBundles).toEqual(STREAM_BUNDLES);
  });
});
