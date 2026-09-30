/**
 * Regression coverage for SupabaseAnalysisAdapter.persistJevPlan (R3b 2.3).
 *
 * The conditional update (`.is('jev_plan', null)`) is the idempotence gate:
 * a second /plan call must never overwrite a stored plan. Also covers the
 * zero-rows branch (stored plan returned; missing row throws).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const serviceMock = vi.hoisted(() => {
  let stored: unknown = null;
  let rowExists = true;
  const state = { writes: 0 };
  const builder = () => {
    const query: Record<string, unknown> = {};
    query.update = (patch: { jev_plan?: unknown }) => {
      state.writes += 1;
      // Conditional update semantics: lands only when the row exists AND has
      // no plan yet (matches the adapter's .is('jev_plan', null) gate).
      const landed = rowExists && stored === null && patch && 'jev_plan' in patch;
      if (landed) stored = patch.jev_plan;
      query.maybeSingle = () =>
        Promise.resolve({ data: landed ? { jev_plan: stored } : null, error: null });
      return query;
    };
    query.eq = () => query;
    query.is = () => query;
    query.select = () => query;
    query.maybeSingle = () => Promise.resolve({ data: rowExists ? { jev_plan: stored } : null, error: null });
    return query;
  };
  return {
    __state: state,
    __setStored: (planValue: unknown) => {
      stored = planValue;
    },
    __setRowExists: (exists: boolean) => {
      rowExists = exists;
    },
    from: () => builder(),
  };
});

vi.mock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => serviceMock }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { SupabaseAnalysisAdapter } from '@/lib/adapters/SupabaseAnalysisAdapter';

beforeEach(() => {
  serviceMock.__setStored(null);
  serviceMock.__setRowExists(true);
  serviceMock.__state.writes = 0;
});

describe('SupabaseAnalysisAdapter.persistJevPlan', () => {
  it('writes once and reports stored=true when the row had no plan', async () => {
    const res = await SupabaseAnalysisAdapter.persistJevPlan({ analysisId: 'a1', plan: { K: 1 } });
    expect(serviceMock.__state.writes).toBe(1);
    expect(res).toEqual({ plan: { K: 1 }, stored: true });
  });

  it('returns the STORED plan without overwriting when one already exists', async () => {
    const stored = { K: 3, cells: [] };
    serviceMock.__setStored(stored);
    const res = await SupabaseAnalysisAdapter.persistJevPlan({ analysisId: 'a1', plan: { K: 1 } });
    expect(res).toEqual({ plan: stored, stored: false });
  });

  it('throws when the analysis row is missing entirely', async () => {
    serviceMock.__setRowExists(false);
    await expect(
      SupabaseAnalysisAdapter.persistJevPlan({ analysisId: 'gone', plan: { K: 1 } })
    ).rejects.toThrow('analysis row not found');
  });
});
