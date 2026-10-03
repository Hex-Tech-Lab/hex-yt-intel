/**
 * SupabaseAuxRemediationAdapter — system sample-run idempotency primitives
 * (#416 follow-up). The service-level behavior (skip checks, race handling)
 * is covered in aux-remediation-enqueue-orphan.test.ts; this file pins the
 * adapter's DB-shaped contracts: 23505 → alreadyQueued, hasSystemSampleRun,
 * analysisHasUsableComments (absent/null/[] are NOT usable).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertResult = vi.hoisted(() => ({ data: null as { id: string } | null, error: null as { code?: string; message: string } | null }));
const probeResult = vi.hoisted(() => ({ data: null as { id: string } | null, error: null as { message: string } | null }));
const payloadResult = vi.hoisted(() => ({ data: null as { analysis_payload: unknown } | null, error: null as { message: string } | null }));

const analysisBuilder = {
  select: () => ({
    eq: () => ({
      maybeSingle: () => Promise.resolve(payloadResult),
    }),
  }),
};

function builderFor(table: string) {
  if (table === 'analyses') return analysisBuilder;
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          limit: () => ({
            maybeSingle: () => Promise.resolve(probeResult),
          }),
        }),
      }),
    }),
  };
}

const insertBuilder = {
  insert: vi.fn((_row: Record<string, unknown>) => ({
    select: () => ({
      single: () => Promise.resolve(insertResult),
    }),
  })),
};

const fromFn = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({ from: fromFn }),
}));

import { SupabaseAuxRemediationAdapter } from '@/lib/adapters/SupabaseAuxRemediationAdapter';

const params = { analysisId: 'an-1', userId: 'u-1', totalCommentCount: 3937 };

beforeEach(() => {
  vi.clearAllMocks();
  insertResult.data = null;
  insertResult.error = null;
  probeResult.data = null;
  probeResult.error = null;
  payloadResult.data = null;
  payloadResult.error = null;
  fromFn.mockImplementation(builderFor);
});

describe('insertSystemCommentSampleRun', () => {
  it('returns the row id on success and stamps mode=cochran', async () => {

    insertResult.data = { id: 'run-1' };
    fromFn.mockImplementation(() => insertBuilder);
    const res = await SupabaseAuxRemediationAdapter.insertSystemCommentSampleRun(params);
    expect(res).toEqual({ id: 'run-1', alreadyQueued: false });
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ analysis_id: 'an-1', status: 'pending', mode: 'cochran', tier: 3 }));
  });

  it('treats a 23505 unique violation as alreadyQueued (not an error, not a failure)', async () => {

    insertResult.data = null;
    insertResult.error = { code: '23505', message: 'duplicate key value violates unique constraint' };
    fromFn.mockImplementation(() => insertBuilder);
    const res = await SupabaseAuxRemediationAdapter.insertSystemCommentSampleRun(params);
    expect(res).toEqual({ id: '', alreadyQueued: true });
  });

  it('returns null on any other insert error', async () => {

    insertResult.data = null;
    insertResult.error = { message: 'connection reset' };
    fromFn.mockImplementation(() => insertBuilder);
    const res = await SupabaseAuxRemediationAdapter.insertSystemCommentSampleRun(params);
    expect(res).toBeNull();
  });
});

describe('hasSystemSampleRun', () => {
  it('is true when a cochran run row exists for the analysis', async () => {
    probeResult.data = { id: 'run-1' };
    expect(await SupabaseAuxRemediationAdapter.hasSystemSampleRun('an-1')).toBe(true);
  });

  it('is false when none exists', async () => {
    probeResult.data = null;
    expect(await SupabaseAuxRemediationAdapter.hasSystemSampleRun('an-1')).toBe(false);
  });

  it('propagates probe errors (caller decides skip-vs-fail, never silently proceeds)', async () => {
    probeResult.error = { message: 'db down' };
    await expect(SupabaseAuxRemediationAdapter.hasSystemSampleRun('an-1')).rejects.toThrow('db down');
  });
});

describe('analysisHasUsableComments', () => {
  it.each([
    ['absent', undefined, false],
    ['null', null, false],
    ['empty array', [], false],
    ['non-empty array', [{ id: 'c1' }], true],
  ])('payload with %s comments → %j', async (_label, comments, expected) => {
    payloadResult.data = { analysis_payload: { comments } };
    expect(await SupabaseAuxRemediationAdapter.analysisHasUsableComments('an-1')).toBe(expected);
  });
});
