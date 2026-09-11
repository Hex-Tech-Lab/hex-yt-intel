/**
 * Dimension Remediation — candidate-SELECTION suite: missing-dimension
 * detection, the transcript-presence candidacy gate, and the PR #310
 * post-merge review follow-ups (P1a eligibility pagination, P1b harness
 * quarantine gate).
 *
 * The per-candidate remediation + failure-counter persistence contract
 * (P1b enforced counter persistence, P1c record_remediation_failure RPC
 * contract, P2c worker-failure-path coverage) lives in the sibling
 * dimension-remediation-retry-burn.test.ts — split per qa-intel's 500-line
 * file gate; markdownWithDimensions / fakeServiceClient are deliberately
 * duplicated per-file, same self-contained-test precedent as
 * analysis-reaper.test.ts and analysis-requeue.test.ts.
 *
 * DB-calling paths are covered with mocked Supabase clients following the
 * analysis-requeue.test.ts pattern — the 2026-09-01 live incident (entire
 * monthly $2.00 hardCap burned in 35 minutes on 12 transcript-purged rows,
 * 88 usage_log events, every tick since silently BudgetExhausted) is the
 * negative control these guards exist to prevent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeMissingDimensions,
  filterGapsWithTranscript,
  MAX_CANDIDATE_PAGES,
  type AnalysisGap,
} from '@/lib/services/dimension-remediation';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

/** Build markdown containing UCIS dimension headers for exactly the given numbers. */
const markdownWithDimensions = (numbers: number[]): string =>
  numbers
    .map((n) => `### DIMENSION ${n}: Section ${n}\n\nSome analysis content for dimension ${n}.`)
    .join('\n\n');
describe('computeMissingDimensions', () => {
  it('returns all dimensions missing for empty markdown', () => {
    expect(computeMissingDimensions('')).toEqual(
      Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1)
    );
  });

  it('returns nothing missing for a complete analysis', () => {
    const all = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1);
    expect(computeMissingDimensions(markdownWithDimensions(all))).toEqual([]);
  });

  it('detects a single missing dimension in the middle', () => {
    const present = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1).filter((n) => n !== 5);
    expect(computeMissingDimensions(markdownWithDimensions(present))).toEqual([5]);
  });

  it('detects multiple non-contiguous missing dimensions', () => {
    const present = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1).filter((n) => ![2, 7, 11].includes(n));
    expect(computeMissingDimensions(markdownWithDimensions(present))).toEqual([2, 7, 11]);
  });

  it('detects a trailing gap (dimensions present 1..8 only, the exact LLMCascade-crash shape)', () => {
    const present = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(computeMissingDimensions(markdownWithDimensions(present))).toEqual([9, 10, 11]);
  });
});

describe('filterGapsWithTranscript (2026-09-11 candidacy gate)', () => {
  const gap = (id: string, videoId: string): AnalysisGap => ({
    id,
    userId: 'u-1',
    videoId,
    title: 't',
    channelTitle: 'c',
    metadata: {},
    analysisMarkdown: markdownWithDimensions([1, 2]),
    analysisPayload: null,
    validationReport: { status: 'partial' },
    missingDimensions: Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1).filter((n) => n > 2),
  });

  it('keeps candidates whose video_id has a transcripts row, drops purged/never-fetched ones', () => {
    const gaps = [gap('a', 'REALID1'), gap('b', 'X_archived_123.456'), gap('c', 'REALID2')];
    const kept = filterGapsWithTranscript(gaps, new Set(['REALID1', 'REALID2']));
    expect(kept.map((g) => g.id)).toEqual(['a', 'c']);
  });

  it('drops everything when the transcripts set is empty (all purged)', () => {
    expect(filterGapsWithTranscript([gap('a', 'V1')], new Set())).toEqual([]);
  });
});
/** Thenable fake for the PostgREST query-builder chain (select → filters → terminal). */
type FakeTableConfig = {
  rows?: Array<Record<string, unknown>>;
  error?: unknown;
  /** Captures the full method-call chain for assertions. */
  calls?: string[];
};

const fakeServiceClient = (tables: Record<string, FakeTableConfig>) => {
  return {
    from: (table: string) => {
      const cfg = tables[table] ?? {};
      const callChain = cfg.calls ?? [];
      const builder: Record<string, unknown> = {
        select: (..._cols: unknown[]) => {
          callChain.push('select');
          return builder;
        },
        eq: (col: string, val: unknown) => {
          callChain.push(`eq:${col}=${String(val)}`);
          return builder;
        },
        or: (expr: string) => {
          callChain.push(`or:${expr}`);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          callChain.push(`in:${col}=[${vals.join(',')}]`);
          return builder;
        },
        order: (col: string, opts: unknown) => {
          callChain.push(`order:${col}:${JSON.stringify(opts ?? {})}`);
          return builder;
        },
        // Post-fix terminal: .range(from, to) with INCLUSIVE `to`.
        // (filter+index instead of .slice — qa-intel's truncation rule
        // pattern-matches .slice as user-visible text truncation.)
        range: (from: number, to: number) => {
          callChain.push(`range:${from}:${to}`);
          return Promise.resolve({
            data: (cfg.rows ?? []).filter((_, i) => i >= from && i <= to),
            error: cfg.error ?? null,
          });
        },
        // Pre-fix terminal (kept so a regression that reintroduces .limit()
        // fails the starvation assertion instead of hanging the suite): DB
        // semantics — first `n` rows of the ordered result.
        limit: (n: number) => {
          callChain.push(`limit:${n}`);
          return Promise.resolve({ data: (cfg.rows ?? []).filter((_, i) => i < n), error: cfg.error ?? null });
        },
        update: (patch: Record<string, unknown>, _opts: unknown) => {
          callChain.push(`update:${JSON.stringify(patch)}`);
          return builder;
        },
        then: (resolve: (val: { data: Array<Record<string, unknown>>; error: unknown }) => unknown) =>
          Promise.resolve(resolve({ data: cfg.rows ?? [], error: cfg.error ?? null })),
      };
      return builder;
    },
    rpc: undefined as unknown, // adapter tests override this per-fixture
  };
};
describe('findAnalysesWithMissingDimensions — transcript-presence gate + eligibility pagination', () => {
  const rowFor = (id: string, videoId: string) => ({
    id,
    video_id: videoId,
    title: 't',
    channel_title: 'c',
    analysis_markdown: markdownWithDimensions([1, 2, 3]),
    analysis_payload: null,
    validation_report: { status: 'partial' },
    billing_status: 'failed',
    user_id: 'u-1',
  });

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/supabase');
    vi.restoreAllMocks();
  });

  it('excludes candidates whose video_id has no transcripts row (2026-09-01 incident shape)', async () => {
    const fromCalls: Record<string, string[]> = {};
    const client = fakeServiceClient({
      analyses: { rows: [rowFor('live-1', 'LIVEID'), rowFor('purged-1', 'PURGEDID'), rowFor('arch-1', 'X_archived_999.1')], calls: (fromCalls.analyses = []) },
      transcripts: { rows: [{ video_id: 'LIVEID' }, { video_id: 'PURGEDID' }], calls: (fromCalls.transcripts = []) },
    });
    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => client }));

    const mod = await import('@/lib/services/dimension-remediation');
    const gaps = await mod.findAnalysesWithMissingDimensions();
    // 'arch-1' (mangled archived video_id, no transcript row ever) is excluded;
    // 'purged-1' still HAS a transcripts row here — the transcripts table is the
    // source of truth, purge is what removes it (this assertion pins that the
    // gate keys on row presence, not the id shape).
    expect(gaps.map((g) => g.id)).toEqual(['live-1', 'purged-1']);
    expect(fromCalls.transcripts).toContain('in:video_id=[LIVEID,PURGEDID,X_archived_999.1]');
  });

  it('NEGATIVE CONTROL (P1a): finds an eligible candidate on page 2 when page 1 is entirely transcript-purged', async () => {
    // limit=2: page 1 = two purged rows (no transcripts row), page 2 = one
    // eligible row WITH a transcripts row. Pre-fix, the single .limit(2)
    // query truncated the population to page 1 and the eligible candidate
    // was starved indefinitely — the exact population PR #310 exists to
    // exclude must never be able to starve real work behind it.
    const fromCalls: Record<string, string[]> = {};
    const client = fakeServiceClient({
      analyses: {
        rows: [rowFor('purged-1', 'PURGEDID'), rowFor('purged-2', 'PURGEDID2'), rowFor('live-1', 'LIVEID')],
        calls: (fromCalls.analyses = []),
      },
      transcripts: { rows: [{ video_id: 'LIVEID' }], calls: (fromCalls.transcripts = []) },
    });
    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => client }));

    const mod = await import('@/lib/services/dimension-remediation');
    const gaps = await mod.findAnalysesWithMissingDimensions({ limit: 2 });
    expect(gaps.map((g) => g.id)).toEqual(['live-1']);
    // Both pages were examined (transcript lookups are batched per page).
    expect(fromCalls.transcripts).toContain('in:video_id=[PURGEDID,PURGEDID2]');
    expect(fromCalls.transcripts).toContain('in:video_id=[LIVEID]');
  });

  it('applies limit to ELIGIBLE gaps (stops paginating once the quota is filled)', async () => {
    const fromCalls: Record<string, string[]> = {};
    const client = fakeServiceClient({
      analyses: {
        rows: [rowFor('e-1', 'V1'), rowFor('e-2', 'V2'), rowFor('e-3', 'V3')],
        calls: (fromCalls.analyses = []),
      },
      transcripts: { rows: [{ video_id: 'V1' }, { video_id: 'V2' }, { video_id: 'V3' }], calls: (fromCalls.transcripts = []) },
    });
    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => client }));

    const mod = await import('@/lib/services/dimension-remediation');
    const gaps = await mod.findAnalysesWithMissingDimensions({ limit: 2 });
    expect(gaps.map((g) => g.id)).toEqual(['e-1', 'e-2']);
    // Only one page needed — the eligible quota filled on page 1.
    expect(fromCalls.analyses.filter((c) => c.startsWith('range:'))).toEqual(['range:0:1']);
  });

  it('stops after MAX_CANDIDATE_PAGES even if every page is transcript-purged (no unbounded pagination)', async () => {
    const fromCalls: Record<string, string[]> = {};
    const client = fakeServiceClient({
      analyses: {
        rows: Array.from({ length: MAX_CANDIDATE_PAGES * 2 + 2 }, (_, i) => rowFor(`purged-${i}`, `PURGEDID${i}`)),
        calls: (fromCalls.analyses = []),
      },
      transcripts: { rows: [], calls: (fromCalls.transcripts = []) },
    });
    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => client }));

    const mod = await import('@/lib/services/dimension-remediation');
    const gaps = await mod.findAnalysesWithMissingDimensions({ limit: 2 });
    expect(gaps).toEqual([]);
    const rangeCalls = fromCalls.analyses.filter((c) => c.startsWith('range:'));
    expect(rangeCalls).toHaveLength(MAX_CANDIDATE_PAGES);
  });

  it('throws (fail closed) when the transcripts presence query itself fails', async () => {
    const client = fakeServiceClient({
      analyses: { rows: [rowFor('live-1', 'LIVEID')] },
      transcripts: { error: new Error('transcripts query failed') },
    });
    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => client }));

    const mod = await import('@/lib/services/dimension-remediation');
    await expect(mod.findAnalysesWithMissingDimensions()).rejects.toThrow('transcripts query failed');
  });
});

describe('runRemediationHarness — quarantine gate (P1b)', () => {
  const rowFor = (id: string, videoId: string) => ({
    id,
    video_id: videoId,
    title: 't',
    channel_title: 'c',
    analysis_markdown: markdownWithDimensions([1, 2, 3]),
    analysis_payload: null,
    validation_report: { status: 'partial' },
    billing_status: 'failed',
    user_id: 'u-1',
  });

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/supabase');
    vi.doUnmock('@/lib/redis');
    vi.doUnmock('@/lib/config/cascade');
    vi.doUnmock('@/lib/adapters/SupabaseSettingsAdapter');
    vi.doUnmock('@/lib/adapters/SupabaseBillingAdapter');
    vi.doUnmock('@/lib/adapters');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips quarantined candidates entirely — no budget consumption, no worker call', async () => {
    const tryConsumeTokenBucket = vi.fn().mockResolvedValue(true);
    const client = fakeServiceClient({
      analyses: { rows: [rowFor('live-1', 'LIVEID')] },
      transcripts: { rows: [{ video_id: 'LIVEID' }] },
    });
    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => client }));
    vi.doMock('@/lib/redis', () => ({
      // Quarantine key present for the candidate (truthy value = quarantined at that ISO ts).
      getRedisValue: vi.fn().mockResolvedValue('2026-09-11T12:00:00.000Z'),
      setRedisValue: vi.fn(() => Promise.resolve()),
      tryConsumeTokenBucket,
      incrementRedisValue: vi.fn().mockResolvedValue(1),
    }));
    vi.doMock('@/lib/config/cascade', () => ({
      resolveAnalysisCascade: vi.fn().mockResolvedValue([{ model: 'm1', name: 'M1' }]),
    }));
    vi.doMock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
      SupabaseSettingsAdapter: {
        getRegistrySettings: vi.fn().mockResolvedValue({
          'remediation.enabled': true,
          'remediation.budgetPercentOfRemaining': 10,
          'remediation.hardCapUsdCents': 200,
          'remediation.maxRetries': 3,
          'remediation.quarantineTtlSeconds': 21600,
        }),
      },
    }));
    vi.doMock('@/lib/adapters/SupabaseBillingAdapter', () => ({
      SupabaseBillingAdapter: { logUsageEvent: vi.fn(() => Promise.resolve()) },
    }));
    const updateAnalysisResult = vi.fn().mockResolvedValue({ updated: true });
    vi.doMock('@/lib/adapters', () => ({
      SupabasePersistenceAdapter: class {
        updateAnalysisResult = updateAnalysisResult;
        recordRemediationFailure = vi.fn().mockResolvedValue({ updated: true });
      },
    }));
    vi.stubGlobal('fetch', vi.fn()); // would hit the network if a candidate were processed

    const mod = await import('@/lib/services/dimension-remediation');
    const result = await mod.runRemediationHarness();
    expect(result.scanned).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.remediated).toBe(0);
    // The quarantined row must not reach the worker or the budget.
    expect(tryConsumeTokenBucket).not.toHaveBeenCalled();
    expect(updateAnalysisResult).not.toHaveBeenCalled();
  });
});
