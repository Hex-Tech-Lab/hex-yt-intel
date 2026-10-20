/**
 * R3b step 2.1 — 2-D chunk matrix key tests (ADR 037 Addendum A).
 *
 * The unique key moves from (analysis_id, chunk_index) to
 * (analysis_id, jev_chunk_index, chunk_index). With K=1 today every write
 * must stamp jev_chunk_index = 0 and every upsert must target the 3-column
 * key; every read that keys by chunk_index alone must narrow to the legacy
 * slice (jev_chunk_index = 0) so a hypothetical future Jev chunk's rows can
 * never leak into the K=1 stitch/presence paths.
 *
 * Mock-client query-pattern tests, same harness as persist-chunk-monotonic.test.ts.
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
  method: 'update' | 'upsert' | 'select';
  data: Record<string, unknown> | undefined;
  filters: Array<{ type: string; column: string; value: unknown }>;
  options?: unknown;
  result: { error: unknown; count: number | null; data?: unknown };
}

function createMockClient() {
  const calls: RecordedCall[] = [];
  let nextResult: { error: unknown; count: number | null; data?: unknown } = { error: null, count: 0 };

  function buildChainable(method: 'update' | 'upsert' | 'select', data: Record<string, unknown> | undefined, options?: unknown) {
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
      select: vi.fn((_cols: string) => chainable),
      single: vi.fn(() => chainable),
      abortSignal: vi.fn(() => chainable),
      then: vi.fn((resolve: (value: any) => void, _reject?: (error: any) => void) => {
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
    select: vi.fn((cols: string) => buildChainable('select', undefined, cols)),
  }));

  const client = { from: fromFn };

  return { client, calls, setNextResult: (result: { error: unknown; count: number | null; data?: unknown }) => { nextResult = result; } };
}

const BASE_PARAMS = {
  analysisId: '550e8400-e29b-41d4-a716-446655440000',
  chunkIndex: 1,
  dimensionsCovered: [1, 10],
  payload: { schemaVersion: '2.0', dimensions: [{ number: 1, name: 'Test', content: 'data' }] },
  status: 'completed' as const,
};

describe('persistAnalysisChunk — 2-D matrix key (R3b 2.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stamps jev_chunk_index = 0 in the row payload', async () => {
    const mock = createMockClient();
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mock.client);
    const adapter = new SupabasePersistenceAdapter();

    await adapter.persistAnalysisChunk({ ...BASE_PARAMS });

    const upsert = mock.calls.find((c) => c.method === 'upsert');
    expect(upsert).toBeDefined();
    expect(upsert!.data).toMatchObject({ jev_chunk_index: 0 });
  });

  it('targets the 3-column matrix key on the completed-path upsert', async () => {
    const mock = createMockClient();
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mock.client);
    const adapter = new SupabasePersistenceAdapter();

    await adapter.persistAnalysisChunk({ ...BASE_PARAMS });

    const upsert = mock.calls.find((c) => c.method === 'upsert');
    expect((upsert!.options as { onConflict?: string }).onConflict).toBe('analysis_id,jev_chunk_index,chunk_index');
  });

  it('targets the 3-column matrix key on the insert-fallback upsert (interrupted path)', async () => {
    const mock = createMockClient();
    mock.setNextResult({ error: null, count: 0 });
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mock.client);
    const adapter = new SupabasePersistenceAdapter();

    await adapter.persistAnalysisChunk({ ...BASE_PARAMS, status: 'interrupted' });

    const fallback = mock.calls.find((c) => c.method === 'upsert');
    expect(fallback).toBeDefined();
    expect((fallback!.options as { onConflict?: string; ignoreDuplicates?: boolean }).onConflict).toBe(
      'analysis_id,jev_chunk_index,chunk_index'
    );
    expect((fallback!.options as { ignoreDuplicates?: boolean }).ignoreDuplicates).toBe(true);
  });

  it('narrows the guarded interrupted-path UPDATE to the jev_chunk_index = 0 slice', async () => {
    const mock = createMockClient();
    mock.setNextResult({ error: null, count: 1 });
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mock.client);
    const adapter = new SupabasePersistenceAdapter();

    await adapter.persistAnalysisChunk({ ...BASE_PARAMS, status: 'interrupted' });

    const update = mock.calls.find((c) => c.method === 'update');
    expect(update).toBeDefined();
    expect(update!.filters).toContainEqual({ type: 'eq', column: 'jev_chunk_index', value: 0 });
  });
});

describe('read paths — legacy-slice isolation (R3b 2.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findAnalysisChunks filters to jev_chunk_index = 0', async () => {
    const mock = createMockClient();
    mock.setNextResult({ error: null, count: null, data: [] });
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mock.client);
    const adapter = new SupabasePersistenceAdapter();

    await adapter.findAnalysisChunks({ analysisId: BASE_PARAMS.analysisId });

    const sel = mock.calls.find((c) => c.method === 'select');
    expect(sel).toBeDefined();
    expect(sel!.filters).toContainEqual({ type: 'eq', column: 'jev_chunk_index', value: 0 });
  });

  it('findAnalysisChunkCoverage filters to jev_chunk_index = 0', async () => {
    const mock = createMockClient();
    mock.setNextResult({ error: null, count: null, data: [] });
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mock.client);
    const adapter = new SupabasePersistenceAdapter();

    await adapter.findAnalysisChunkCoverage({ analysisId: BASE_PARAMS.analysisId });

    const sel = mock.calls.find((c) => c.method === 'select');
    expect(sel!.filters).toContainEqual({ type: 'eq', column: 'jev_chunk_index', value: 0 });
  });

  it('markChunkFailed narrows its CAS update to jev_chunk_index = 0', async () => {
    const mock = createMockClient();
    mock.setNextResult({ error: null, count: 1 });
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mock.client);
    const adapter = new SupabasePersistenceAdapter();

    await adapter.markChunkFailed({ analysisId: BASE_PARAMS.analysisId, chunkIndex: 1, observedUpdatedAt: null });

    const update = mock.calls.find((c) => c.method === 'update');
    expect(update!.filters).toContainEqual({ type: 'eq', column: 'jev_chunk_index', value: 0 });
  });

  it('isChunkAlreadyPersisted narrows its single-row read to jev_chunk_index = 0', async () => {
    const mock = createMockClient();
    mock.setNextResult({ error: null, count: null, data: { chunk_index: 1, status: 'completed' } });
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mock.client);
    const adapter = new SupabasePersistenceAdapter();

    await adapter.isChunkAlreadyPersisted(BASE_PARAMS.analysisId, 1);

    const sel = mock.calls.find((c) => c.method === 'select');
    expect(sel!.filters).toContainEqual({ type: 'eq', column: 'jev_chunk_index', value: 0 });
  });
});
