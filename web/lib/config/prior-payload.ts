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
  const requestedBytes = Number(requested);
  const base = Number.isFinite(requestedBytes) && requestedBytes > 0 ? Math.floor(requestedBytes) : PRIOR_PAYLOAD_MAX_BYTES_FALLBACK;
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

const TRIM_NOTE = ' [trimmed to fit the grounded-evidence size cap]';

function serializedBytes(payload: { schemaVersion: '2.0'; dimensions: SanitizedPriorDimension[] }): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

/**
 * Client-side counterpart of the worker guard (CodeRabbit #363): shape the
 * grounded dimensions into a payload that the worker will ACCEPT. Without
 * this, a long analysis's grounded output could exceed the byte cap, the
 * worker returns 400, the retry resends the same payload, and dims 9/11
 * never run. Keeps only {number, content}; when over the cap, trims every
 * dimension's content by the same ratio (visible marker) until it fits; if
 * nothing fits, returns an empty-but-valid payload so the projective stream
 * still runs rather than failing.
 */
export function fitPriorPayloadToCap(
  dimensions: ReadonlyArray<{ number: unknown; content: unknown }>,
  maxBytes: unknown
): { schemaVersion: '2.0'; dimensions: SanitizedPriorDimension[] } {
  const cap = resolvePriorPayloadMaxBytes(maxBytes);
  let dims: SanitizedPriorDimension[] = dimensions
    .filter((dim): dim is SanitizedPriorDimension =>
      Number.isInteger(dim.number) && (dim.number as number) >= 1 && (dim.number as number) <= PRIOR_PAYLOAD_DIMENSIONS_MAX
      && typeof dim.content === 'string')
    // One entry per dimension number (first wins) -- also bounds the list at
    // PRIOR_PAYLOAD_DIMENSIONS_MAX, since numbers are already limited to 1..11.
    .filter((dim, index, all) => all.findIndex((other) => other.number === dim.number) === index)
    .map((dim) => ({ number: dim.number, content: dim.content }));
  const originals = dims.map((dim) => dim.content);
  let ratio = 1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const payload = { schemaVersion: '2.0' as const, dimensions: dims };
    const size = serializedBytes(payload);
    if (size <= cap) return payload;
    ratio *= (cap / size) * 0.9;
    dims = dims.map((dim, index) => {
      const keep = Math.max(0, Math.floor(originals[index]!.length * ratio));
      return { number: dim.number, content: originals[index]!.slice(0, keep) + '...' + TRIM_NOTE };
    });
  }
  // Small caps: per-dimension JSON + trim-note overhead can exceed the cap even
  // with near-empty content. Keep the largest fitting PREFIX (lowest dimension
  // numbers first) instead of sending nothing (CodeRabbit #363).
  while (dims.length > 0) {
    dims = dims.slice(0, -1);
    const subset = { schemaVersion: '2.0' as const, dimensions: dims };
    if (serializedBytes(subset) <= cap) return subset;
  }
  return { schemaVersion: '2.0', dimensions: [] };
}

