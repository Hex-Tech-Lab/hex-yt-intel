/**
 * Type guard: does an unknown payload (from the DB's JSONB `payload` column,
 * which can contain ANY JSON value — string, number, boolean, null, object)
 * have a usable `dimensions` array shape?
 *
 * Extracted from stitch-analysis-chunks.ts (PR #314 second review round):
 * the persist route's settled-stitch and contract-check paths used
 * `'dimensions' in chunk.payload` directly. The `in` operator throws a
 * TypeError when the LHS is a primitive (string/number/boolean/null), and
 * `AnalysisPersistencePort`'s `payload` field is typed
 * `Record<string, unknown>` — a compile-time lie about what the DB can
 * actually contain. This predicate centralizes the typeof guard so every
 * call site is safe without each one repeating the boilerplate.
 *
 * Lives in its own module so the 500-line qa-intel monolith-file gate stays
 * satisfied for stitch-analysis-chunks.ts (which re-exports this for its
 * existing callers).
 *
 * Kept as a const arrow (not a `function` declaration) so DeepSource's
 * global-scope-function-declaration finding (JS-0067) doesn't fire on the
 * new module.
 */
export const hasUsableDimensionsPayload = (payload: unknown): payload is { dimensions: unknown[] } =>
  typeof payload === 'object' &&
  payload !== null &&
  'dimensions' in payload &&
  Array.isArray((payload as Record<string, unknown>).dimensions);
