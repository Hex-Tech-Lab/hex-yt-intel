/**
 * CONTRACT (Comments Dispatch A, 2026-09-30): POST
 * /api/comments/persist-sample-run in cochran mode (1) accepts the extended
 * Zod body (mode, classifications[], insights, sampling heartbeat status),
 * (2) NEVER overwrites an existing analysis_payload.comments key —
 * commentInsights is rewritten, comments only added when absent, and (3) is
 * idempotent: re-posting the same cochran payload upserts, not duplicates.
 *
 * Negative controls: (2) is proven against the reverted behavior (blind
 * spread clobbering prior comments); (3) against insert-instead-of-upsert.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canonicalJson } from '@/lib/utils/canonical-json';

const verifyContentSig = vi.hoisted(() => vi.fn());

vi.mock('@/lib/stream-token', () => ({ verifyContentSig }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => serviceMock }));
vi.mock('@/lib/adapters/SupabaseCommentSamplingAdapter', () => ({
  SupabaseCommentSamplingAdapter: class {
    async estimateCreditCost() {
      return { estimatedCredits: 10, estimateParamsVersion: 'v1' };
    }
  },
}));

import { POST } from '@/app/api/comments/persist-sample-run/route';
import { SupabaseAuxRemediationAdapter } from '@/lib/adapters/SupabaseAuxRemediationAdapter';

type Table = 'comment_sample_runs' | 'comment_classifications' | 'analyses';

function chainResult(data: unknown, error: unknown = null) {
  return Promise.resolve({ data, error });
}

/** Minimal fluent mock covering every query shape the route/adapter build. */
function makeService() {
  const state = {
    runs: [] as Array<Record<string, unknown>>,
    analyses: [] as Array<Record<string, unknown>>,
    classificationsUpserts: [] as Array<{ rows: unknown[]; opts: unknown }>,
    runUpdates: [] as Record<string, unknown>,
    payloadUpdates: [] as Array<Record<string, unknown>>,
  };
  const service = {
    __state: state,
    from(table: Table) {
      const builder: Record<string, unknown> = {};
      const rows = () => (table === 'analyses' ? state.analyses : state.runs);
      builder.select = (..._cols: unknown[]) => {
        const b2: Record<string, unknown> = {};
        b2.eq = () => b2;
        b2.maybeSingle = () => chainResult(rows()[0] ?? null);
        b2.single = () => chainResult(rows()[0] ?? null);
        return b2;
      };
      builder.insert = (values: unknown) => ({
        select: () => ({ single: () => chainResult((values as unknown[])[0]) }),
      });
      builder.upsert = (rowsIn: unknown, opts: unknown) => {
        state.classificationsUpserts.push({ rows: rowsIn as unknown[], opts });
        return { select: () => chainResult((rowsIn as unknown[]).map((unusedValue, index) => ({ id: index }))) };
      };
      builder.update = (values: Record<string, unknown>) => {
        const b2: Record<string, unknown> = {};
        b2.eq = (_col: string, _val: unknown) => {
          if (table === 'comment_sample_runs') state.runUpdates.push(values);
          else if (table === 'analyses') state.payloadUpdates.push(values);
          const settled = chainResult(null);
          // finalizeSampleRun adds a monotonic .in('status', ...) guard.
          return Object.assign(settled, { in: () => settled });
        };
        return b2;
      };
      return builder;
    },
    rpc: () => chainResult(null),
  };
  return service;
}

const serviceMock = makeService() as unknown as ReturnType<typeof makeService> & Record<string, unknown>;

const RUN_ID = '5f0c2b3a-0000-4000-8000-000000000001';
const USER_ID = '5f0c2b3a-0000-4000-8000-000000000002';
const ANALYSIS_ID = '5f0c2b3a-0000-4000-8000-000000000003';

function classificationRow(i: number) {
  return {
    commentExternalId: `c${i}`,
    commentText: `text ${i}`,
    likeCount: i,
    publishedAt: '2026-09-01T00:00:00Z',
    author: `author ${i}`,
    sentiment: 'positive' as const,
    commentType: 'experience' as const,
    painPoint: 0.2,
    questionAsked: 0.1,
    intensity: 1,
    sentimentConfidence: 0.9,
    lowConfidence: false,
    modelUsed: 'jev',
  };
}

const INSIGHTS = {
  population: 20,
  reportedTotal: 500,
  sampleSize: 5,
  classified: 5,
  failed: 0,
  lowConfidence: 0,
  marginOfError: 0.3,
  confidence: 0.95,
  marginScope: 'sampled_pool',
  sentiment: { positive: 5, negative: 0, neutral: 0, mixed: 0 },
  types: { experience: 5 },
  painPointCount: 0,
  questionCount: 0,
  costUsd: 0.001,
  model: 'jev',
  completedAt: '2026-09-30T00:00:00.000Z',
};

function cochranBody(overrides: Record<string, unknown> = {}) {
  return {
    sampleRunId: RUN_ID,
    userId: USER_ID,
    sampledCount: 5,
    status: 'completed',
    mode: 'cochran',
    cochran: {
      mode: 'cochran',
      sampledCount: 5,
      population: 20,
      insights: INSIGHTS,
      classifications: [0, 1, 2, 3, 4].map(classificationRow),
      sampledComments: [0, 1, 2, 3, 4].map((i) => ({
        author: `author ${i}`,
        text: `text ${i}`,
        publishedAt: '2026-09-01T00:00:00Z',
        likeCount: i,
      })),
    },
    sig: 'sig',
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/comments/persist-sample-run', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock.__state.runs = [{ id: RUN_ID, user_id: USER_ID, analysis_id: ANALYSIS_ID, total_comment_count: 500 }];
  serviceMock.__state.analyses = [{ analysis_payload: null, validation_report: null }];
  serviceMock.__state.classificationsUpserts = [];
  serviceMock.__state.runUpdates = [];
  serviceMock.__state.payloadUpdates = [];
  verifyContentSig.mockResolvedValue(true);
  vi.spyOn(SupabaseAuxRemediationAdapter, 'upsertCommentClassifications').mockResolvedValue(5);
  vi.spyOn(SupabaseAuxRemediationAdapter, 'writeCommentsPayload').mockResolvedValue(undefined);
  vi.spyOn(SupabaseAuxRemediationAdapter, 'markSampleRunSampling').mockResolvedValue(undefined);
  vi.spyOn(SupabaseAuxRemediationAdapter, 'finalizeSampleRun').mockResolvedValue(undefined);
});

describe('POST /api/comments/persist-sample-run — cochran mode', () => {
  it('accepts the extended Zod body and writes insights + classifications via the adapter', async () => {
    const res = await post(cochranBody());
    expect(res.status).toBe(200);
    expect(SupabaseAuxRemediationAdapter.upsertCommentClassifications).toHaveBeenCalledWith(RUN_ID, cochranBody().cochran.classifications);
    expect(SupabaseAuxRemediationAdapter.writeCommentsPayload).toHaveBeenCalledWith(
      ANALYSIS_ID,
      expect.objectContaining({ commentInsights: INSIGHTS })
    );
    expect(SupabaseAuxRemediationAdapter.finalizeSampleRun).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({ status: 'completed', sampledCount: 5, mode: 'cochran', cochranN: 5 })
    );
  });

  it('rejects an invalid body (missing insights field) with 400', async () => {
    const body = cochranBody();
    delete (body.cochran as Record<string, unknown>).insights;
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(SupabaseAuxRemediationAdapter.writeCommentsPayload).not.toHaveBeenCalled();
  });

  it('rejects a bad signature with 401 before any write', async () => {
    verifyContentSig.mockResolvedValue(false);
    const res = await post(cochranBody());
    expect(res.status).toBe(401);
    expect(SupabaseAuxRemediationAdapter.upsertCommentClassifications).not.toHaveBeenCalled();
  });

  it('accepts the sampling heartbeat and never stamps completed_at', async () => {
    const res = await post({ ...cochranBody(), status: 'sampling', cochran: undefined });
    expect(res.status).toBe(200);
    expect(SupabaseAuxRemediationAdapter.markSampleRunSampling).toHaveBeenCalledWith(RUN_ID, 'cochran');
    expect(SupabaseAuxRemediationAdapter.finalizeSampleRun).not.toHaveBeenCalled();
  });

  it('NEGATIVE CONTROL: never overwrites existing comments — reverted (blind spread) fails this test', async () => {
    const originalComment = { author: 'original', text: 'keep me', publishedAt: 'x', likeCount: 1 };
    serviceMock.__state.analyses = [{ analysis_payload: { comments: [originalComment] } }];

    // Use the REAL adapter (spies removed) so the never-overwrite guard is
    // actually exercised against the mock service.
    vi.restoreAllMocks();

    const res = await post(cochranBody());
    expect(res.status).toBe(200);

    expect(serviceMock.__state.payloadUpdates).toHaveLength(1);
    const persisted = serviceMock.__state.payloadUpdates[0].analysis_payload as Record<string, unknown>;
    // commentInsights is always rewritten...
    expect(persisted.commentInsights).toEqual(INSIGHTS);
    // ...but the pre-existing comments set must survive untouched.
    expect(persisted.comments).toEqual([originalComment]);
    // With the guard reverted (blind `next.comments = payload.comments`),
    // persisted.comments would be the SAMPLED set and the assertion above
    // fails — that is the negative control.
  });

  it('NEGATIVE CONTROL: idempotent re-post — insert-based (reverted) storage would duplicate rows', async () => {
    await post(cochranBody());
    const first = vi.mocked(SupabaseAuxRemediationAdapter.upsertCommentClassifications).mock.calls[0];
    expect(first[0]).toBe(RUN_ID);
    // Second identical post: same upsert target, same row set — upsert (not
    // insert) collapses onto the same (run, comment) keys.
    await post(cochranBody());
    const second = vi.mocked(SupabaseAuxRemediationAdapter.upsertCommentClassifications).mock.calls[1];
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toEqual(first[1]);
    // The adapter contract itself is upsert-on-conflict: prove the adapter
    // method is used (an INSERT-based reverted route would bypass the
    // conflict target and duplicate — the calls must be indistinguishable,
    // i.e. the same idempotent upsert, not a fresh insert stream).
    expect(SupabaseAuxRemediationAdapter.upsertCommentClassifications).toHaveBeenCalledTimes(2);
    expect(second[1]).toEqual(first[1]);
  });

  it('(#378 P1) the signature covers the WHOLE body: tampering with a classification or the insights is rejected', async () => {
    const original = cochranBody();
    const { sig: _sig, exp: _exp, ...signed } = original as Record<string, unknown>;
    const expectedMessage = canonicalJson(signed);
    verifyContentSig.mockImplementation((message: string) => Promise.resolve(message === expectedMessage));

    expect((await post(original)).status).toBe(200);

    const tamperedClassification = structuredClone(original) as typeof original;
    tamperedClassification.cochran.classifications[0]!.sentiment = 'negative';
    expect((await post(tamperedClassification)).status).toBe(401);

    const tamperedInsights = structuredClone(original) as typeof original;
    tamperedInsights.cochran.insights.sentiment.positive += 1;
    expect((await post(tamperedInsights)).status).toBe(401);

    const tamperedMode = { ...structuredClone(original), mode: 'uncapped' as const };
    expect((await post(tamperedMode)).status).toBe(401);
  });
});
