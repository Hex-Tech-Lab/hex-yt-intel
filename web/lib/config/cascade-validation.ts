import { z } from 'zod';
import { CASCADE_MODEL_ALLOWLIST } from './cascade';

/**
 * ADR 040 (2026-10-05): save-time structural validation for cascade.*
 * Settings Registry values.
 *
 * The `setting_definitions.validation` column for cascade.* rows carries
 * the marker {"kind":"cascadeRegistry"}; the admin settings save path
 * (web/app/api/admin/settings/[key]/route.ts) dispatches to
 * validateCascadeRegistryValue when it sees that marker. The allowlist
 * itself lives in CODE (CASCADE_MODEL_ALLOWLIST, derived from
 * CASCADE_FALLBACKS in cascade.ts) so it cannot drift from what the code
 * actually resolves — it is updated via the same PR flow as code changes,
 * never stored in the DB.
 */

export const CASCADE_REGISTRY_VALIDATION_MARKER = { kind: 'cascadeRegistry' } as const;

const CascadeRegistryItemSchema = z
  .object({
    model: z.string().min(1),
    name: z.string().min(1),
    cost: z.number().finite().min(0).optional(),
    providerOrder: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** Returns null when valid, else a human-readable error for the admin UI. */
export function validateCascadeRegistryValue(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return 'Expected an array of cascade tiers';
  }
  if (value.length === 0) {
    return 'Cascade must contain at least one tier (an empty cascade resolves to code fallbacks — save the explicit tiers you want instead)';
  }
  for (const item of value) {
    const parsed = CascadeRegistryItemSchema.safeParse(item);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
      return `Invalid cascade tier — ${path}${first?.message ?? 'schema mismatch'}`;
    }
    if (!CASCADE_MODEL_ALLOWLIST.includes(parsed.data.model)) {
      return `Unknown model ID "${parsed.data.model}" — not in the code-derived allowlist (CASCADE_MODEL_ALLOWLIST in web/lib/config/cascade.ts). Update the code registry via PR first (ADR 040).`;
    }
  }
  return null;
}
