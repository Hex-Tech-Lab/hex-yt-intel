/**
 * Contract tests for the atomic analysis_payload key-merge persistence layer
 * (PR #322 round-2 P1: read-modify-write lost-update race + swallowed
 * persistence errors + zero-row updates unnoticed).
 *
 * 1. Migration SQL: the merge must be database-side jsonb_set, never a
 *    client-side full-payload rewrite; anon/public must be revoked.
 * 2. SupabaseAnalysisPayloadAdapter: bounded retry, zero-row verification,
 *    Sentry capture, and never throwing into the request path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const MIGRATION = path.resolve(__dirname, '../../../../supabase/migrations/20260924120000_merge_analysis_payload_key_rpc.sql');

vi.mock('@/lib/adapters/SupabaseSettingsAdapter', async () => {
  const { RELATIONS_REGISTRY_FALLBACK } = await import('@/lib/utils/relations-settings');
  return {
    SupabaseSettingsAdapter: {
      getRegistrySettings: vi.fn((keys: string[]) => {
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = (RELATIONS_REGISTRY_FALLBACK as Record<string, unknown>)[k] ?? true;
        return Promise.resolve(out);
      }),
    },
  };
});

const { SupabaseAnalysisPayloadAdapter } = await import('@/lib/adapters/SupabaseAnalysisPayloadAdapter');

const makeClient = (rpcImpl: () => unknown) => {
  // Supabase's rpc() resolves { data, error } — the impl returns the shape.
  return { rpc: vi.fn(async () => ({ data: await rpcImpl(), error: null })) } as unknown as Parameters<typeof SupabaseAnalysisPayloadAdapter>[0];
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('migration SQL contract (merge_analysis_payload_key)', () => {
  it('merges via jsonb_set on the existing payload — never a whole-column rewrite', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf-8');
    expect(sql).toContain('jsonb_set');
    expect(sql).toMatch(/coalesce\(a\.analysis_payload/);
    // The update must reference the existing column value inside jsonb_set,
    // not assign analysis_payload = a client-merged object.
    expect(sql).toMatch(/set analysis_payload = jsonb_set/);
  });

  it('returns the affected row count so zero-row writes are verifiable', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf-8');
    expect(sql).toContain('returns integer');
    expect(sql).toContain('get diagnostics affected = row_count');
  });

  it('revokes anon/public and grants only authenticated + service_role', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf-8');
    expect(sql).toMatch(/revoke execute .* from anon, public/);
    expect(sql).toMatch(/grant execute .* to authenticated, service_role/);
  });

  it('checks the actual role claim (service_role) and ownership (auth.uid), not a uid-null inference', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf-8');
    expect(sql).toContain("auth.role() = 'service_role'");
    expect(sql).toContain('auth.uid() is not null and a.user_id = auth.uid()');
  });
});

describe('SupabaseAnalysisPayloadAdapter', () => {
  it('calls the merge RPC with only (id, key, value) and reports success', async () => {
    const client = makeClient(() => 1);
    const adapter = new SupabaseAnalysisPayloadAdapter(client);
    const result = await adapter.mergePayloadKey('a1', 'stance_relations', { insights: [] });
    expect(result).toEqual({ persisted: true, affectedRows: 1 });
    expect(client.rpc).toHaveBeenCalledWith('merge_analysis_payload_key', {
      p_id: 'a1', p_key: 'stance_relations', p_value: { insights: [] },
    });
  });

  it('retries transient RPC errors up to relations.persistMaxAttempts then succeeds', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Zero out the backoff so the test doesn't sleep the real
    // relations.persistRetryBaseDelayMs=250 (+500) between attempts.
    const { SupabaseSettingsAdapter } = await import('@/lib/adapters/SupabaseSettingsAdapter');
    vi.mocked(SupabaseSettingsAdapter.getRegistrySettings).mockResolvedValue({
      'relations.persistMaxAttempts': 3,
      'relations.persistRetryBaseDelayMs': 0,
    });
    let calls = 0;
    const client = makeClient(() => {
      calls++;
      if (calls < 3) throw new Error('transient network');
      return 1;
    });
    const adapter = new SupabaseAnalysisPayloadAdapter(client);
    const result = await adapter.mergePayloadKey('a1', 'stance_relations', {});
    expect(calls).toBe(3); // relations.persistMaxAttempts
    expect(result).toEqual({ persisted: true, affectedRows: 1 });
    warnSpy.mockRestore();
  });

  it('zero-row update is surfaced as persisted:false, not success', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = makeClient(() => 0);
    const adapter = new SupabaseAnalysisPayloadAdapter(client);
    const result = await adapter.mergePayloadKey('a1', 'stance_relations', {});
    expect(result).toEqual({ persisted: false, affectedRows: 0 });
    errSpy.mockRestore();
  });

  it('never throws: after final failed attempt returns persisted:false (fail-soft contract)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = makeClient(() => { throw new Error('permanent'); });
    const adapter = new SupabaseAnalysisPayloadAdapter(client);
    await expect(adapter.mergePayloadKey('a1', 'stance_relations', {})).resolves.toEqual({ persisted: false, affectedRows: 0 });
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});
