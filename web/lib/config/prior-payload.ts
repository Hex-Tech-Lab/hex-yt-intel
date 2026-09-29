import { z } from 'zod';

/**
 * R1d (2026-09-29): boundary guard for `prior_payload` — the grounded
 * dimensions payload the browser forwards to the projective worker stream,
 * which PromptBuilder injects verbatim into a paid LLM prompt. Without this
 * guard the worker accepted unbounded, untyped JSON (Finding 4, CC 96-hour
 * audit). Full server-side re-derivation of grounded dims by analysisId is
 * phase R2; this module is the shared schema + cap + projective-only rule
 * used by BOTH the worker boundary (routes/analysis.ts) and the web vitest
 * suite (worker has no vitest harness of its own — ledger 2026-09-28).
 */

/** Registry-key fallback; the live value is `analysis.layer2.priorPayloadMaxBytes` (ADR 005: worker has no DB access). */
export const PRIOR_PAYLOAD_MAX_BYTES_FALLBACK = 65536;

export const PRIOR_PAYLOAD_DIMENSIONS_MAX = 11;

/**
 * Hard ceiling the worker enforces no matter what the request says. The byte
 * cap travels in the stream request, which the HMAC token does NOT sign
 * (only videoId/analysisId/exp/models are signed), so a client can send any
 * value. The registry key can LOWER the cap below this; nothing can raise it.
 */
export const PRIOR_PAYLOAD_MAX_BYTES_CEILING = 65536;

export function resolvePriorPayloadMaxBytes(requested: unknown): number {
  const n = Number(requested);
  const base = Number.isFinite(n) && n > 0 ? Math.floor(n) : PRIOR_PAYLOAD_MAX_BYTES_FALLBACK;
  return Math.min(base, PRIOR_PAYLOAD_MAX_BYTES_CEILING);
}

export const PriorPayloadDimensionSchema = z
  .object({
    number: z.number().int().min(1).max(PRIOR_PAYLOAD_DIMENSIONS_MAX),
    content: z.string(),
  })
  .passthrough();

export const PriorPayloadSchema = z
  .object({
    schemaVersion: z.literal('2.0'),
    dimensions: z.array(PriorPayloadDimensionSchema).max(PRIOR_PAYLOAD_DIMENSIONS_MAX),
  })
  .strict();

export type PriorPayload = z.infer<typeof PriorPayloadSchema>;

/** Only the validated number + content pairs are ever stringified into the prompt (passthrough keys dropped). */
export interface SanitizedPriorDimension {
  number: number;
  content: string;
}

export type PriorPayloadValidationResult =
  | { ok: true; dimensions: SanitizedPriorDimension[] }
  | { ok: false; reason: string };

/**
 * Validate + sanitize a candidate prior_payload against the R1d contract:
 * strict schema, at most maxBytes serialized, and accepted only for
 * projective bundles (grounded bundles must never carry a prior payload —
 * the caller drops it with a warning, it is NOT a rejection).
 */
export function validatePriorPayload(
  payload: unknown,
  options: { maxBytes: number; isProjective: boolean }
): PriorPayloadValidationResult {
  if (!options.isProjective) {
    return { ok: false, reason: 'grounded_bundle_rejects_prior_payload' };
  }
  const parsed = PriorPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: `schema_violation: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
  }
  const serialized = JSON.stringify({ schemaVersion: parsed.data.schemaVersion, dimensions: parsed.data.dimensions });
  const byteLength = new TextEncoder().encode(serialized).length;
  if (byteLength > options.maxBytes) {
    return { ok: false, reason: `exceeds_max_bytes: ${byteLength} > ${options.maxBytes}` };
  }
  return {
    ok: true,
    dimensions: parsed.data.dimensions.map((d) => ({ number: d.number, content: d.content })),
  };
}
