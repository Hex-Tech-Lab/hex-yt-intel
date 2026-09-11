/**
 * Monotonic chunk persistence tests (PR #305 P1 fix, 2026-09-11).
 *
 * When a bundle's retry succeeds after the first attempt failed mid-stream,
 * the worker's delayed `interrupted` persist (fired via `waitUntil` from the
 * abort path) can land AFTER the retry's `completed` persist — both target
 * the same `analysis_id` + `chunk_index`. The fix in
 * SupabasePersistenceAdapter.persistAnalysisChunk makes `interrupted` writes
 * monotonic: they can never overwrite a row already at `completed`.
 *
 * These tests mock the Supabase service client to verify the query pattern
 * (guarded UPDATE + ignoreDuplicates fallback) without needing a live DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

import { getSupabaseServiceClient } from '@/lib/supabase';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';

interface RecordedCall {
  method: 'update' | 'upsert';
  data: Record<string, unknown>;
  filters: Array<{ type: string; column: string; value: unknown }>;
  options?: unknown;
  result: { error: unknown; count: number | null };
}

function createMockClient() {
  const calls: RecordedCall[] = [];
  let nextResult: { error: unknown; count: number | null } = { error: null, count: 0 };

  // Each chainable builder captures filters and resolves to nextResult when awaited.
  // The real Supabase client returns a thenable from the filter chain — we mimic that.
  function buildChainable(method: 'update' | 'upsert', data: Record<string, unknown>, options?: unknown) {
    const filters: Array<{ type: string; column: string; value: unknown }> = [];

    const chainable: any = {
      eq: vi.fn((col: string, val: unknown) => {
        filters.push({ type: 'eq', column: col, value: val });
        return chainable;
      }),
      neq: vi.fn((col: string, val: unknown) => {
        filters.push({ type: 'neq', column: col, value: val });
        return chainable;
      }),
      // Make it thenable so `await` works on the chain
      then: vi.fn((resolve: (value: any) => void, reject?: (error: any) => void) => {
        const result = nextResult;
        calls.push({ method, data, filters: [...filters], options, result });
        Promise.resolve().then(() => resolve(nextResult));
      }),
    };

    return chainable;
  }

  const fromFn = vi.fn((_table: string) => ({
    update: vi.fn((data: Record<string, unknown>, opts?: unknown) => buildChainable('update', data, opts)),
    upsert: vi.fn((data: Record<string, unknown>, opts?: unknown) => buildChainable('upsert', data, opts)),
  }));

  const client = { from: fromFn };

  return { client, calls, setNextResult: (result: { error: unknown; count: number | null }) => { nextResult = result; } };
}

const BASE_PARAMS = {
  analysisId: '550e8400-e29b-41d4-a716-446655440000',
  chunkIndex: 1,
  dimensionsCovered: [1, 10],
  payload: { schemaVersion: '2.0', dimensions: [{ number: 1, name: 'Test', content: 'data' }] },
  tokensUsed: 100,
  costUsd: 0.001,
  generationId: 'gen-123',
};

describe('persistAnalysisChunk monotonic-status guard (PR #305 P1 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delayed interrupted write does NOT overwrite an already-completed chunk', async () => {
    // Simulate the race: attempt 2 already persisted a 'completed' chunk,
    // then attempt 1's delayed 'interrupted' write arrives.
    //
    // The guarded UPDATE with .neq('status', 'completed') should match ZERO
    // rows (the existing row IS 'completed'), so count=0. The fallback
    // upsert with ignoreDuplicates should then silently skip (the row
    // already exists). The final persisted state must remain 'completed'.
    const { client, calls, setNextResult } = createMockClient();
    vi.mocked(getSupabaseServiceClient).mockReturnValue(client as any);

    const adapter = new SupabasePersistenceAdapter();

    // Step 1: attempt 2 persists 'completed' (blind upsert)
    setNextResult({ error: null, count: 1 });
    await adapter.persistAnalysisChunk({ ...BASE_PARAMS, status: 'completed' });

    // Step 2: delayed 'interrupted' write from attempt 1 arrives
    // The guarded UPDATE should return count=0 (row is 'completed', .neq filter excludes it)
    setNextResult({ error: null, count: 0 });
    await adapter.persistAnalysisChunk({ ...BASE_PARAMS, status: 'interrupted' });

    // Verify the guarded UPDATE was used (not a blind upsert)
    const interruptedUpdateCall = calls.find(call => call.method === 'update' && call.data.status === 'interrupted');
    expect(interruptedUpdateCall).toBeDefined();
    expect(interruptedUpdateCall!.filters).toContainEqual({ type: 'neq', column: 'status', value: 'completed' });
    expect(interruptedUpdateCall!.filters).toContainEqual({ type: 'eq', column: 'analysis_id', value: BASE_PARAMS.analysisId });
    expect(interruptedUpdateCall!.filters).toContainEqual({ type: 'eq', column: 'chunk_index', value: BASE_PARAMS.chunkIndex });

    // Verify the fallback upsert was called (count=0 triggered it)
    const fallbackUpsertCall = calls.find(call => call.method === 'upsert' && call.data.status === 'interrupted');
    expect(fallbackUpsertCall).toBeDefined();
  });

  it('interrupted write DOES insert when no row exists yet (first attempt fails, no retry)', async () => {
    // No prior 'completed' row — the guarded UPDATE returns count=0 (no row
    // to update), the fallback upsert inserts a new 'interrupted' row.
    const { client, calls, setNextResult } = createMockClient();
    vi.mocked(getSupabaseServiceClient).mockReturnValue(client as any);

    const adapter = new SupabasePersistenceAdapter();

    // Guarded UPDATE: no row exists → count=0
    setNextResult({ error: null, count: 0 });
    await adapter.persistAnalysisChunk({ ...BASE_PARAMS, status: 'interrupted' });

    // The fallback upsert should have been called to insert the new row
    const fallbackCall = calls.find(call => call.method === 'upsert' && call.data.status === 'interrupted');
    expect(fallbackCall).toBeDefined();
    expect(fallbackCall!.data.status).toBe('interrupted');
  });

  it('interrupted write DOES update an existing interrupted row (refresh with newer data)', async () => {
    // A row already exists as 'interrupted' — a new 'interrupted' write
    // (e.g. with more captured dimensions) should update it, since
    // 'interrupted' is not 'completed'. The guarded UPDATE matches and
    // count > 0, so no fallback insert is needed.
    const { client, calls, setNextResult } = createMockClient();
    vi.mocked(getSupabaseServiceClient).mockReturnValue(client as any);

    const adapter = new SupabasePersistenceAdapter();

    // Guarded UPDATE: row exists as 'interrupted', .neq('status', 'completed') matches → count=1
    setNextResult({ error: null, count: 1 });
    await adapter.persistAnalysisChunk({ ...BASE_PARAMS, status: 'interrupted' });

    // The guarded UPDATE should have been called and succeeded
    const updateCall = calls.find(call => call.method === 'update' && call.data.status === 'interrupted');
    expect(updateCall).toBeDefined();

    // No fallback upsert should have been called (count > 0)
    const fallbackCall = calls.find(call => call.method === 'upsert' && call.data.status === 'interrupted');
    expect(fallbackCall).toBeUndefined();
  });

  it('completed write uses blind upsert (replaces any prior interrupted row)', async () => {
    // A 'completed' write should always go through, replacing any prior
    // 'interrupted' row — the correct precedence direction.
    const { client, calls, setNextResult } = createMockClient();
    vi.mocked(getSupabaseServiceClient).mockReturnValue(client as any);

    const adapter = new SupabasePersistenceAdapter();

    setNextResult({ error: null, count: 1 });
    await adapter.persistAnalysisChunk({ ...BASE_PARAMS, status: 'completed' });

    // Should use blind upsert, NOT the guarded update path
    const upsertCall = calls.find(call => call.method === 'upsert' && call.data.status === 'completed');
    expect(upsertCall).toBeDefined();

    // No guarded update should have been called for 'completed'
    const updateCall = calls.find(call => call.method === 'update' && call.data.status === 'completed');
    expect(updateCall).toBeUndefined();
  });
});
