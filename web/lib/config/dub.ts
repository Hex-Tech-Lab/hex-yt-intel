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
  requestTimeoutMs: number;
}

const DUB_CONFIG_FALLBACK: DubConfig = {
  domain: 'go.getvintel.com',
  enabled: true,
  // 'dub.requestTimeoutMs' is not yet a registered setting_definitions row
  // (not in the 20260819233412 migration) -- this always resolves to the
  // fallback for now. Tracked in docs/TECH_DEBT_LEDGER.md; not worth a
  // dedicated migration under launch pressure for one timeout value, but
  // keeping it in this single resolve call (not a second registry
  // round-trip) means it's free to register properly later.
  requestTimeoutMs: 8000,
};

const REGISTRY_KEYS = {
  'dub.domain': DUB_CONFIG_FALLBACK.domain,
  'dub.enabled': DUB_CONFIG_FALLBACK.enabled,
  'dub.requestTimeoutMs': DUB_CONFIG_FALLBACK.requestTimeoutMs,
};

// Single Settings-Registry round-trip for all Dub config (real efficiency
// finding 2026-08-20, /simplify review -- createLink() previously fetched
// dub.domain/dub.enabled here, then request() independently fetched
// dub.requestTimeoutMs, two sequential DB round-trips per share-link create).
export async function resolveDubConfig(): Promise<DubConfig> {
  const resolved = await SupabaseSettingsAdapter.getRegistrySettings(Object.keys(REGISTRY_KEYS), REGISTRY_KEYS);
  const domain = typeof resolved['dub.domain'] === 'string' && resolved['dub.domain'].length > 0
    ? (resolved['dub.domain'] as string)
    : DUB_CONFIG_FALLBACK.domain;
  const enabled = typeof resolved['dub.enabled'] === 'boolean'
    ? (resolved['dub.enabled'] as boolean)
    : DUB_CONFIG_FALLBACK.enabled;
  const requestTimeoutMs = typeof resolved['dub.requestTimeoutMs'] === 'number' && resolved['dub.requestTimeoutMs'] > 0
    ? (resolved['dub.requestTimeoutMs'] as number)
    : DUB_CONFIG_FALLBACK.requestTimeoutMs;
  return { domain, enabled, requestTimeoutMs };
}
