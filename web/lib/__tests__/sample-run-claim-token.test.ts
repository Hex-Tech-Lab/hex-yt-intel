/**
 * T12c: per-delivery claim token on the 'sampling' claim, plus the global
 * stale-run sweep's conditional transitions. A tiny in-memory row store backs
 * the Supabase query builder so the conditional WHERE clauses are really
 * evaluated (a retry that is owned must claim; a foreign token must not).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = { id: string; status: string; claimed_by: string | null; reenqueued_at: string | null; created_at: string };
const store = vi.hoisted(() => ({ rows: [] as Array<Row> }));

// Evaluate the subset of PostgREST filters the adapter uses against the store.
function matches(row: Row, filters: Array<(r: Row) => boolean>): boolean {
  return filters.every((f) => f(row));
}

function makeBuilder() {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Partial<Row> | null = null;
  const b: Record<string, unknown> = {};
  const chain = (fn: (r: Row) => boolean) => { filters.push(fn); return b; };
  b.eq = (col: keyof Row, val: unknown) => chain((r) => r[col] === val);
  b.is = (col: keyof Row, val: unknown) => chain((r) => r[col] === val);
  b.not = (col: keyof Row, _op: string, val: unknown) => chain((r) => (val === null ? r[col] !== null : r[col] !== val));
  b.lt = (col: keyof Row, val: string) => chain((r) => r[col] !== null && (r[col] as string) < val);
  // Only the shape the adapter emits: "reenqueued_at.lt.<c>,and(reenqueued_at.is.null,created_at.lt.<c>)".
  b.or = (expr: string) => {
    const cutoff = (expr.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/) ?? [''])[0];
    return chain((r) => (r.reenqueued_at !== null ? r.reenqueued_at < cutoff : r.created_at < cutoff));
  };
  b.update = (p: Partial<Row>) => { patch = p; return b; };
  b.select = () => {
    // After update(): the write resolves here. Otherwise it is a read and stays chainable.
    if (!patch) return b;
    const hit = store.rows.filter((r) => matches(r, filters));
    hit.forEach((r) => Object.assign(r, patch));
    return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), count: hit.length, error: null });
  };
  b.maybeSingle = () => {
    const hit = store.rows.filter((r) => matches(r, filters));
    return Promise.resolve({ data: hit[0] ? { id: hit[0].id } : null, error: null });
  };
  return b;
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({ from: () => makeBuilder() }),
}));

import { SupabaseAuxRemediationAdapter } from '@/lib/adapters/SupabaseAuxRemediationAdapter';

const RUN = 'run-1';
function seed(status: string, claimed_by: string | null): void {
  store.rows = [{ id: RUN, status, claimed_by, reenqueued_at: null, created_at: '2026-10-13T00:00:00Z' }];
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

  it('a live consumer claim that lands before the sweep wins: sweep cannot fail a run that is no longer pending', async () => {
    seed('sampling', 'delivery-A');
    expect(await SupabaseAuxRemediationAdapter.failStaleSampleRun(RUN, 'pending', '2026-10-13T00:30:00Z')).toBe(false);
    expect(row().status).toBe('sampling');
  });
});
