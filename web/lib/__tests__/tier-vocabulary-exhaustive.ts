import type { UserTier } from '@/lib/types/billing';

/**
 * Compile-time exhaustiveness helper: the object is `satisfies Record<UserTier, number>`,
 * so every UserTier member MUST appear as a key or the build fails; the
 * runtime list is then compared against the expected literal in the test,
 * so an ADDED member also trips the test until it is deliberately accepted.
 */
const USER_TIER_KEY_RECORD = {
  free: 1,
  light: 1,
  pro: 1,
  max: 1,
  enterprise: 1,
} satisfies Record<UserTier, number>;

export const UserTierSchemaForTest = Object.keys(USER_TIER_KEY_RECORD);
