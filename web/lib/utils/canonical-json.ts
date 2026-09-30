/**
 * Deterministic JSON for signatures: object keys sorted recursively,
 * `undefined` members dropped (as JSON.stringify does), arrays kept in order.
 * Shared by the worker (signer) and Vercel (verifier) so both sides hash the
 * exact same bytes for the same body (#378 review: the HMAC must cover the
 * whole write body, not a three-field subset).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}
