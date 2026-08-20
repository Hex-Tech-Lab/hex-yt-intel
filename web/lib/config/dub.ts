import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';

/**
 * Dub.co short-link config, Settings-Registry-driven (migration
 * 20260819230000_dub_and_testsprite_registry.sql, keys 'dub.domain' /
 * 'dub.enabled') per explicit user directive 2026-08-19 ("this is supposed
 * to be configuration-based, persistent in the database, part of the
 * settings registry"). Mirrors web/lib/config/cascade.ts's exact
 * resolve-with-fallback pattern: DUB_CONFIG_FALLBACK below is ONLY used if
 * the registry is unreachable, kept in sync with the migration's seeded
 * default_value, never the live source of truth. Callers MUST use
 * resolveDubConfig(), never process.env.DUB_DOMAIN directly.
 */
export interface DubConfig {
  domain: string;
  enabled: boolean;
}

const DUB_CONFIG_FALLBACK: DubConfig = {
  domain: 'go.getvintel.com',
  enabled: true,
};

const REGISTRY_KEYS = { 'dub.domain': DUB_CONFIG_FALLBACK.domain, 'dub.enabled': DUB_CONFIG_FALLBACK.enabled };

export async function resolveDubConfig(): Promise<DubConfig> {
  const resolved = await SupabaseSettingsAdapter.getRegistrySettings(Object.keys(REGISTRY_KEYS), REGISTRY_KEYS);
  const domain = typeof resolved['dub.domain'] === 'string' && resolved['dub.domain'].length > 0
    ? (resolved['dub.domain'] as string)
    : DUB_CONFIG_FALLBACK.domain;
  const enabled = typeof resolved['dub.enabled'] === 'boolean'
    ? (resolved['dub.enabled'] as boolean)
    : DUB_CONFIG_FALLBACK.enabled;
  return { domain, enabled };
}
