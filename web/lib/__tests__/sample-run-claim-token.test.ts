/**
 * T12c: per-delivery claim token on the 'sampling' claim, plus the global
 * stale-run sweep's conditional transitions. A tiny in-memory row store backs
 * the Supabase query builder so the conditional WHERE clauses are really
 * evaluated (a retry that is owned must claim; a foreign token must not).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = { id: string; mode?: string; status: string; claimed_by: string | null; claimed_at: string | null; reenqueued_at: string | null; created_at: string };
const store = vi.hoisted(() => ({ rows: [] as Array<Row> }));

// Evaluate the subset of PostgREST filters the adapter uses against the store.
type Filter = (row: Row) => boolean;
const matches = (row: Row, filters: Filter[]): boolean => filters.every((filter) => filter(row));

function termHolds(candidate: Row, termExpr: string): boolean {
  const [col, op, ...rest] = termExpr.split('.');
  const value = candidate[col as keyof Row];
  return op === 'is' ? value === null : value !== null && (value as string) < rest.join('.');
}

function makeBuilder() {
  const filters: Filter[] = [];
  let patch: Partial<Row> | null = null;
  const builder: Record<string, unknown> = {};
  const chain = (filter: Filter) => { filters.push(filter); return builder; };
  builder.eq = (col: keyof Row, val: unknown) => chain((row) => row[col] === val);
  builder.is = (col: keyof Row, val: unknown) => chain((row) => row[col] === val);
  builder.not = (col: keyof Row, _op: string, val: unknown) => chain((row) => (val === null ? row[col] !== null : row[col] !== val));
  builder.lt = (col: keyof Row, val: string) => chain((row) => row[col] !== null && (row[col] as string) < val);
  // Evaluates the real PostgREST or() expression: top-level alternatives, each
  // either "col.lt.X" or "and(col.is.null,col.lt.X,...)", so a wrong filter fails tests.
  builder.or = (expr: string) => {
    const alts = expr.match(/and\([^)]*\)|[a-z_]+\.[a-z]+\.[^,()]+/g) ?? [];
    return chain((row) =>
      alts.some((alt) =>
        (alt.startsWith('and(') ? alt.slice(4, -1).split(/,(?=[a-z_]+\.)/) : [alt]).every((termExpr) => termHolds(row, termExpr))
      )
    );
  };
  builder.update = (changes: Partial<Row>) => { patch = changes; return builder; };
  builder.select = () => {
    // After update(): the write resolves here. Otherwise it is a read and stays chainable.
    if (!patch) return builder;
    const hit = store.rows.filter((row) => matches(row, filters));
    hit.forEach((hitRow) => Object.assign(hitRow, patch));
    return Promise.resolve({ data: hit.map((hitRow) => ({ id: hitRow.id })), count: hit.length, error: null });
  };
  builder.order = () => builder;
  builder.limit = () => Promise.resolve({ data: store.rows.filter((row) => matches(row, filters)).map((row) => ({ ...row })), error: null });
  builder.maybeSingle = () => {
    const hit = store.rows.filter((row) => matches(row, filters));
    return Promise.resolve({ data: hit[0] ? { id: hit[0].id } : null, error: null });
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({ from: () => makeBuilder() }),
}));

import { SupabaseAuxRemediationAdapter } from '@/lib/adapters/SupabaseAuxRemediationAdapter';

const RUN = 'run-1';
function seed(status: string, claimed_by: string | null): void {
  store.rows = [{ id: RUN, status, claimed_by, claimed_at: null, reenqueued_at: null, created_at: '2026-10-13T00:00:00Z' }];
}
const row = (): Row => store.rows[0] as Row;

beforeEach(() => {
  store.rows = [];
});

describe('markSampleRunSampling — per-delivery claim token', () => {
  it('pending -> sampling records the claiming delivery token and reports claimed:true', async () => {
    seed('pending', null);
    const res = await SupabaseAuxRemediationAdapter.markSampleRunSampling(RUN, 'cochran', 'delivery-A');
    expect(res).toEqual({ claimed: true });
    expect(row().status).toBe('sampling');
    expect(row().claimed_by).toBe('delivery-A');
    expect(row().claimed_at).not.toBeNull();
  });

  it('timed-out claim retried by the SAME delivery: sampling + claimed_by matches -> claimed:true exactly once (no second owner)', async () => {
    seed('sampling', 'delivery-A');
    const res = await SupabaseAuxRemediationAdapter.markSampleRunSampling(RUN, 'cochran', 'delivery-A');
    expect(res).toEqual({ claimed: true });
    expect(row().claimed_by).toBe('delivery-A');
  });

  it('negative control: a DIFFERENT token on a sampling run -> claimed:false and ownership unchanged', async () => {
    seed('sampling', 'delivery-A');
    const res = await SupabaseAuxRemediationAdapter.markSampleRunSampling(RUN, 'cochran', 'delivery-B');
    expect(res).toEqual({ claimed: false });
    expect(row().claimed_by).toBe('delivery-A');
  });

  it('no token on a sampling run (legacy callers) -> claimed:false, as before', async () => {
    seed('sampling', 'delivery-A');
    const res = await SupabaseAuxRemediationAdapter.markSampleRunSampling(RUN, 'cochran');
    expect(res).toEqual({ claimed: false });
  });

  it('a completed run never re-claims, even for its own token', async () => {
    seed('completed', 'delivery-A');
    const res = await SupabaseAuxRemediationAdapter.markSampleRunSampling(RUN, 'cochran', 'delivery-A');
    expect(res).toEqual({ claimed: false });
    expect(row().status).toBe('completed');
  });
});

describe('global sweep transitions are conditional', () => {
  it('re-enqueue stamp is won exactly once (second sweep pass loses)', async () => {
    seed('pending', null);
    expect(await SupabaseAuxRemediationAdapter.markSampleRunReenqueued(RUN, '2026-10-13T01:00:00Z')).toBe(true);
    expect(await SupabaseAuxRemediationAdapter.markSampleRunReenqueued(RUN, '2026-10-13T01:05:00Z')).toBe(false);
    expect(row().reenqueued_at).toBe('2026-10-13T01:00:00Z');
  });

  it('failing a stale sampling run only succeeds while it is still sampling', async () => {
    seed('completed', 'delivery-A');
    const changed = await SupabaseAuxRemediationAdapter.failStaleSampleRun(RUN, 'sampling', '2026-10-13T00:30:00Z');
    expect(changed).toBe(false);
    expect(row().status).toBe('completed');
  });

  it('fails a stale sampling run (created before the cutoff) and then reports it changed', async () => {
    seed('sampling', 'delivery-A');
    expect(await SupabaseAuxRemediationAdapter.failStaleSampleRun(RUN, 'sampling', '2026-10-13T00:30:00Z')).toBe(true);
    expect(row().status).toBe('failed');
  });

  it('a run created long ago but claimed just now is NOT stale (live consumer wins); negative control: stale claim is failed', async () => {
    seed('sampling', 'delivery-A');
    row().claimed_at = '2026-10-13T01:00:00Z'; // created 00:00 (stale by created_at), claimed 01:00 (fresh)
    expect(await SupabaseAuxRemediationAdapter.failStaleSampleRun(RUN, 'sampling', '2026-10-13T00:30:00Z')).toBe(false);
    expect(row().status).toBe('sampling');
    expect(await SupabaseAuxRemediationAdapter.failStaleSampleRun(RUN, 'sampling', '2026-10-13T01:30:00Z')).toBe(true);
    expect(row().status).toBe('failed');
  });

  it('a live consumer claim that lands before the sweep wins: sweep cannot fail a run that is no longer pending', async () => {
    seed('sampling', 'delivery-A');
    expect(await SupabaseAuxRemediationAdapter.failStaleSampleRun(RUN, 'pending', '2026-10-13T00:30:00Z')).toBe(false);
    expect(row().status).toBe('sampling');
  });
});

describe('sweep finders select exactly the right rows (cochran only)', () => {
  const CUT = '2026-10-13T00:30:00.000Z';
  type Seed = Partial<Row> & { id: string; mode?: string };
  const put = (rows: Seed[]) => {
    store.rows = rows.map((seed) => ({ mode: 'cochran', status: 'pending', claimed_by: null, claimed_at: null, reenqueued_at: null, created_at: '2026-10-13T00:00:00Z', ...seed })) as Row[];
  };

  it('requeue finder: stale pending, never re-enqueued; skips fresh, already re-enqueued and sampling', async () => {
    put([
      { id: 'stale' },
      { id: 'fresh', created_at: '2026-10-13T01:00:00Z' },
      { id: 'already', reenqueued_at: '2026-10-13T00:10:00Z' },
      { id: 'sampling', status: 'sampling' },
    ]);
    const rows = await SupabaseAuxRemediationAdapter.findPendingRunsForRequeue(CUT, 10);
    expect(rows.map((found) => found.id)).toEqual(['stale']);
  });

  it('failure finder (pending): only re-enqueued runs whose re-enqueue is older than the cutoff', async () => {
    put([
      { id: 'a', reenqueued_at: '2026-10-13T00:10:00Z' },
      { id: 'b', reenqueued_at: '2026-10-13T01:00:00Z' },
      { id: 'c' },
    ]);
    const rows = await SupabaseAuxRemediationAdapter.findPendingRunsForFailure(CUT, 10);
    expect(rows.map((found) => found.id)).toEqual(['a']);
  });

  it('failure finder (sampling): by claimed_at; freshly claimed old run excluded', async () => {
    put([
      { id: 'old', status: 'sampling', claimed_at: '2026-10-13T00:05:00Z' },
      { id: 'justClaimed', status: 'sampling', claimed_at: '2026-10-13T01:00:00Z' },
      { id: 'legacy', status: 'sampling' },
    ]);
    const rows = await SupabaseAuxRemediationAdapter.findSamplingRunsForFailure(CUT, 10);
    expect(rows.map((found) => found.id).sort()).toEqual(['legacy', 'old']);
  });

  it('uncapped runs are never swept (mode filter pinned)', async () => {
    put([{ id: 'u', mode: 'uncapped' }, { id: 'c', mode: 'cochran' }]);
    expect((await SupabaseAuxRemediationAdapter.findPendingRunsForRequeue(CUT, 10)).map((found) => found.id)).toEqual(['c']);
  });
});
