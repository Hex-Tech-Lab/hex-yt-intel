import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

let failDb = false;
const KEY = 'analysis.pipeline.epistemic';

function chain(result: () => { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'in']) builder[method] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    try { return Promise.resolve(result()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => chain(() => {
      if (failDb) throw new Error('registry unreachable');
      if (table === 'setting_definitions') return { data: [{ key: KEY, default_value: false }], error: null };
      return { data: [{ setting_key: KEY, value: true }], error: null };
    }),
  }),
}));

describe('SupabaseSettingsAdapter.getRegistrySettings after a refresh failure', () => {
  let now = 1_000_000;
  beforeEach(async () => {
    failDb = false;
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { SupabaseSettingsAdapter } = await import('../adapters/SupabaseSettingsAdapter');
    (SupabaseSettingsAdapter as unknown as { registryCache: Map<string, unknown> }).registryCache.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves the live value while the cache is fresh', async () => {
    const { SupabaseSettingsAdapter } = await import('../adapters/SupabaseSettingsAdapter');
    const settings = await SupabaseSettingsAdapter.getRegistrySettings([KEY], { [KEY]: false });
    expect(settings[KEY]).toBe(true);
  });

  it('falls back to the caller default, not an expired cached true, when the registry is unreachable', async () => {
    const { SupabaseSettingsAdapter } = await import('../adapters/SupabaseSettingsAdapter');
    await SupabaseSettingsAdapter.getRegistrySettings([KEY], { [KEY]: false });
    now += 61_000;
    failDb = true;
    const settings = await SupabaseSettingsAdapter.getRegistrySettings([KEY], { [KEY]: false });
    expect(settings[KEY]).toBe(false);
  });
});
