import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';

/**
 * TestSprite auth-bypass Settings-Registry toggle (migration
 * 20260819230000_dub_and_testsprite_registry.sql, key
 * 'testAuthBypass.enabled') per explicit user directive 2026-08-19: whether
 * the bypass is enabled at all must be a real registry entry, not just
 * "env secret happens to be set". Defaults OFF (security-sensitive) both in
 * the migration's seeded default_value AND in this fallback -- if the
 * registry is unreachable, the bypass fails closed.
 */
const FALLBACK_ENABLED = false;
const REGISTRY_KEY = 'testAuthBypass.enabled';

export async function resolveTestAuthBypassEnabled(): Promise<boolean> {
  const resolved = await SupabaseSettingsAdapter.getRegistrySettings(
    [REGISTRY_KEY],
    { [REGISTRY_KEY]: FALLBACK_ENABLED }
  );
  return resolved[REGISTRY_KEY] === true;
}
