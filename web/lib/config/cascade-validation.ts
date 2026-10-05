import { z } from 'zod';
import {
  CASCADE_MODEL_ALLOWLIST,
  DIARIZATION_PROVIDER_ALLOWLIST,
} from './cascade';

/**
 * ADR 040 (2026-10-05): save-time structural validation for cascade.*
 * Settings Registry values.
 *
 * The `setting_definitions.validation` column for cascade.* rows carries
 * the marker {"kind":"cascadeRegistry"}; the admin settings save path
 * (web/app/api/admin/settings/[key]/route.ts) dispatches to
 * validateCascadeRegistryValue when it sees that marker. The allowlist
 * itself lives in CODE (CASCADE_MODEL_ALLOWLIST, derived from
 * CASCADE_FALLBACKS in cascade.ts, and DIARIZATION_PROVIDER_ALLOWLIST for
 * cascade.diarization) so it cannot drift from what the code actually resolves
 * — updated via the same PR flow as code changes, never stored in the DB.
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

const DiarizationCascadeItemSchema = z
  .object({
    provider: z.string().min(1),
    name: z.string().min(1),
    timeoutMs: z.number().positive().finite().optional(),
  })
  .strict();

/**
 * Validates cascade.diarization: array of provider strings OR array of DiarizationCascadeItem objects.
 * Both formats are supported for maximum ergonomic flexibility.
 */
export function validateDiarizationCascadeValue(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return 'Expected an array of diarization providers';
  }
  if (value.length === 0) {
    return 'Diarization cascade must contain at least one provider';
  }

  for (const item of value) {
    let providerName: string;

    if (typeof item === 'string') {
      providerName = item;
    } else if (item && typeof item === 'object') {
      const parsed = DiarizationCascadeItemSchema.safeParse(item);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const path = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
        return `Invalid diarization cascade tier — ${path}${first?.message ?? 'schema mismatch'}`;
      }
      providerName = parsed.data.provider;
    } else {
      return 'Invalid diarization provider entry: expected string provider name or object';
    }

    if (!DIARIZATION_PROVIDER_ALLOWLIST.includes(providerName as never)) {
      return `Unknown diarization provider "${providerName}" — not in allowlist (${DIARIZATION_PROVIDER_ALLOWLIST.join(', ')}).`;
    }
  }

  return null;
}

/** Returns null when valid, else a human-readable error for the admin UI. */
export function validateCascadeRegistryValue(value: unknown, key?: string): string | null {
  if (key === 'cascade.diarization') {
    return validateDiarizationCascadeValue(value);
  }

  if (!Array.isArray(value)) {
    return 'Expected an array of cascade tiers';
  }
  if (value.length === 0) {
    return 'Cascade must contain at least one tier (an empty cascade resolves to code fallbacks — save the explicit tiers you want instead)';
  }

  // For non-diarization cascades, every item must strictly be a CascadeRegistryItem
  for (const item of value) {
    // If a diarization provider or item is passed to a non-diarization cascade key, reject immediately
    if (
      (typeof item === 'string' && DIARIZATION_PROVIDER_ALLOWLIST.includes(item as never)) ||
      (item && typeof item === 'object' && 'provider' in item)
    ) {
      return `Diarization providers cannot be used for general LLM cascade key "${key ?? 'unknown'}". Use models from the allowlist instead.`;
    }

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
