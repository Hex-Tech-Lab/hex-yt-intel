import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: {
    getRegistrySettings: vi.fn(),
  },
}));

import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import {
  resolveAnalysisCascade,
  resolveChatCascade,
  CASCADE_FALLBACKS,
  CASCADE_MODEL_ALLOWLIST,
  type CascadeItem,
} from '@/lib/config/cascade';

const getRegistrySettings = vi.mocked(SupabaseSettingsAdapter.getRegistrySettings);

const HAIKU_TIERS = CASCADE_FALLBACKS.analysis.filter((i) => i.model === 'anthropic/claude-haiku-5.5');

beforeEach(() => {
  getRegistrySettings.mockReset();
  // Default: registry returns the caller fallback (key absent → negative cache null keeps fallback reference).
  getRegistrySettings.mockImplementation((keys, fallback) => Promise.resolve({ ...fallback }));
});

describe('resolveCascade capability stamping (ADR 041)', () => {
  it('stamps the haiku output cap + provider-pinning requirement on fallback items when the registry is absent', async () => {
    const items = await resolveAnalysisCascade();
    const haiku = items.find((i) => i.name === 'Claude Haiku 5.5 (Vertex)');
    expect(haiku?.maxOutputTokens).toBe(8192);
    expect(haiku?.requiresProviderOrder).toBe(true);
    // Unbound tiers stay unstamped — the worker's forwarded default cap remains their live source.
    const sonnet = items.find((i) => i.model === 'anthropic/claude-sonnet-5');
    expect(sonnet && 'maxOutputTokens' in sonnet && sonnet.maxOutputTokens !== undefined).toBe(false);
    expect(sonnet?.requiresProviderOrder).toBeUndefined();
  });

  it('stamps capabilities by model ID onto registry-resolved items (DB values carry no capability fields)', async () => {
    const dbValue: CascadeItem[] = [{ model: 'anthropic/claude-haiku-5.5', name: 'Haiku (Vertex)', providerOrder: ['google-vertex'] }];
    getRegistrySettings.mockImplementation((keys, fallback) => {
      const out = { ...fallback } as Record<string, unknown>;
      out['cascade.analysis'] = dbValue;
      return Promise.resolve(out as typeof fallback);
    });

    const items = await resolveAnalysisCascade();
    expect(items).toHaveLength(1);
    expect(items[0]?.maxOutputTokens).toBe(8192);
    expect(items[0]?.requiresProviderOrder).toBe(true);
  });

  it('rejects a tier requiring provider order when providerOrder is missing or empty', async () => {
    const dbValue: CascadeItem[] = [{ model: 'anthropic/claude-haiku-5.5', name: 'Haiku (Vertex)' }];
    getRegistrySettings.mockImplementation((keys, fallback) => {
      const out = { ...fallback } as Record<string, unknown>;
      out['cascade.analysis'] = dbValue;
      return Promise.resolve(out as typeof fallback);
    });

    await expect(resolveAnalysisCascade()).rejects.toThrow(/requires a non-empty providerOrder/);
  });

  it('resolves the cap from the analysis.maxOutputTokens.* registry keys, not a static value', async () => {
    getRegistrySettings.mockImplementation((keys, fallback) => {
      const out = { ...fallback } as Record<string, unknown>;
      out['analysis.maxOutputTokens.haiku'] = 6000;
      return Promise.resolve(out as typeof fallback);
    });

    const items = await resolveAnalysisCascade();
    const haiku = items.find((i) => i.model === 'anthropic/claude-haiku-5.5');
    expect(haiku?.maxOutputTokens).toBe(6000);
  });

  it('throws an explicit SSOT violation when the registry returns a malformed value (no silent fallback)', async () => {
    getRegistrySettings.mockImplementation((keys, fallback) => {
      const out = { ...fallback } as Record<string, unknown>;
      out['cascade.analysis'] = 'not-an-array';
      return Promise.resolve(out as typeof fallback);
    });
    await expect(resolveAnalysisCascade()).rejects.toThrow(/SSOT Violation.*non-empty array/);
  });

  it('throws when a registry-resolved tier has an empty model ID', async () => {
    getRegistrySettings.mockImplementation((keys, fallback) => {
      const out = { ...fallback } as Record<string, unknown>;
      out['cascade.analysis'] = [{ model: '   ', name: 'Blank' }];
      return Promise.resolve(out as typeof fallback);
    });
    await expect(resolveAnalysisCascade()).rejects.toThrow(/empty or missing model ID/);
  });

  it('throws when a registry-resolved tier has an empty display name', async () => {
    getRegistrySettings.mockImplementation((keys, fallback) => {
      const out = { ...fallback } as Record<string, unknown>;
      out['cascade.analysis'] = [{ model: 'test/model-a', name: '  ' }];
      return Promise.resolve(out as typeof fallback);
    });
    await expect(resolveAnalysisCascade()).rejects.toThrow(/empty or missing display name/);
  });

  it('chat cascade resolves through the same stamped path', async () => {
    const items = await resolveChatCascade();
    expect(items.length).toBeGreaterThan(0);
    const bound = items.find((i) => MODEL_CAPABILITIES_HAS(i.model));
    // chat cascade has no capability-bound models — everything stays unstamped.
    expect(bound).toBeUndefined();
  });

  it('the ADR 040 allowlist still derives from the fallbacks (haiku included)', () => {
    expect(CASCADE_MODEL_ALLOWLIST).toContain('anthropic/claude-haiku-5.5');
    expect(HAIKU_TIERS.length).toBe(4);
  });

  it('haiku 5.5 is capability-bound (8192 cap + provider pinning) and in the allowlist', async () => {
    expect(CASCADE_MODEL_ALLOWLIST).toContain('anthropic/claude-haiku-5.5');
    const dbValue: CascadeItem[] = [{ model: 'anthropic/claude-haiku-5.5', name: 'Haiku 5.5 (Vertex)', providerOrder: ['google-vertex'] }];
    getRegistrySettings.mockImplementation((keys, fallback) => {
      const out = { ...fallback } as Record<string, unknown>;
      out['cascade.analysis'] = dbValue;
      return Promise.resolve(out as typeof fallback);
    });
    const items = await resolveAnalysisCascade();
    expect(items[0]?.maxOutputTokens).toBe(8192);
    expect(items[0]?.requiresProviderOrder).toBe(true);
  });

  it('analysis fallback runs on haiku 5.5 tiers, not 4.5', () => {
    const haikuModels = CASCADE_FALLBACKS.analysis.filter((i) => i.model.includes('haiku')).map((i) => i.model);
    expect(haikuModels.length).toBe(4);
    expect(haikuModels.every((m) => m === 'anthropic/claude-haiku-5.5')).toBe(true);
  });
});

function MODEL_CAPABILITIES_HAS(model: string): boolean {
  // chat cascade's models are not capability-bound (see MODEL_CAPABILITIES in cascade.ts)
  return model === 'anthropic/claude-haiku-5.5';
}

describe('resolveCascade reasoning stamping (analysis.reasoning.*)', () => {
  it('stamps registry defaults (grounded none, projective low) on every tier', async () => {
    const items = await resolveAnalysisCascade();
    for (const item of items) {
      expect(item.reasoningGrounded).toBe('none');
      expect(item.reasoningProjective).toBe('low');
    }
  });

  it('bumps none to low for models whose reasoning is mandatory (z-ai/glm-5.3-flash)', async () => {
    getRegistrySettings.mockImplementation((keys, fallback) => {
      const out = { ...fallback } as Record<string, unknown>;
      out['cascade.analysis'] = [{ model: 'z-ai/glm-5.3-flash', name: 'GLM' }];
      out['analysis.reasoning.projective'] = 'none';
      return Promise.resolve(out as typeof fallback);
    });
    const [glm] = await resolveAnalysisCascade();
    expect(glm?.reasoningGrounded).toBe('low');
    expect(glm?.reasoningProjective).toBe('low');
  });

  it('rejects a registry effort outside none|minimal|low', async () => {
    getRegistrySettings.mockImplementation((keys, fallback) => {
      const out = { ...fallback } as Record<string, unknown>;
      out['analysis.reasoning.grounded'] = 'high';
      return Promise.resolve(out as typeof fallback);
    });
    await expect(resolveAnalysisCascade()).rejects.toThrow(/analysis\.reasoning\.grounded/);
  });
});

describe('reasoning keys are scoped to cascade.analysis (PR #443 review)', () => {
  it('chat resolution neither reads nor validates analysis.reasoning.* (an invalid value cannot break it)', async () => {
    getRegistrySettings.mockImplementation((keys, fallback) => {
      const out = { ...fallback } as Record<string, unknown>;
      out['analysis.reasoning.grounded'] = 'high';
      return Promise.resolve(out as typeof fallback);
    });
    const items = await resolveChatCascade();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.reasoningGrounded === undefined && i.reasoningProjective === undefined)).toBe(true);
    const requestedKeys = getRegistrySettings.mock.calls.at(-1)?.[0] as string[];
    expect(requestedKeys.some((k) => k.startsWith('analysis.reasoning.'))).toBe(false);
  });

  it('allowlist accepts capability-registered rollback models absent from fallbacks', () => {
    expect(CASCADE_MODEL_ALLOWLIST).toContain('anthropic/claude-haiku-4.5');
    expect(CASCADE_MODEL_ALLOWLIST).toContain('anthropic/claude-haiku-5.5');
  });
});
