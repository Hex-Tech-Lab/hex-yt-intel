/**
 * Durable side-effect claim marker (P1, PR #314 second review round, item 4).
 *
 * The crash window being mitigated: after the parent finalize's CAS write
 * wins ('processing' → terminal), the route fires downstream side effects —
 * analysis-cache write, QStash validation/digest/highlights publishes. Those
 * are NOT atomic with the CAS write: a crash between the two leaves the row
 * terminally settled with its side effects permanently missing (no cache
 * entry → a paid re-analysis can happen, violating ADR Law #1; no digest /
 * highlights task → silently missing panels).
 *
 * Full transactional outbox (a dedicated table + relay worker) is out of
 * scope for this PR. This is the documented, testable partial mitigation:
 *
 *   1. `side_effects_pending: true` is recorded in the validation_report
 *      patch of the SAME atomic RPC write that performs the CAS transition —
 *      so the marker can never be orphaned by a crash between the transition
 *      and a separate marker write (there is no separate write).
 *   2. The marker is only set when side effects are actually going to be
 *      fired by this path (billingStatus === 'completed' / isNonChunkValid).
 *   3. After every tracked side effect succeeds, the marker is cleared with a
 *      best-effort `updateValidationReport` (preserveValidationPassed — the
 *      CAS winner already owns the row). If any side effect failed, the
 *      marker is deliberately LEFT SET: the row is observably incomplete.
 *   4. Reconciliation hook point: a future cron can query
 *      `analyses.validation_report->>'side_effects_pending' = 'true'` and
 *      re-fire the publishes — the digest and highlights tasks are already
 *      idempotent (skipIfPresent) and the cache write is an upsert, so
 *      at-least-once replay is safe. The cron itself is deliberately NOT
 *      built in this PR (scope decision documented in the dispatch report);
 *      this module exports the predicate such a cron needs.
 */

export const SIDE_EFFECTS_PENDING_REPORT_KEY = 'side_effects_pending';

/** The report patch that records the pending claim alongside the CAS transition. */
export type SideEffectsPendingClaim = { side_effects_pending: true };

/** The report shape used to clear the claim after all side effects succeeded. */
export type SideEffectsClearedPatch = { side_effects_pending: false };

/**
 * Add the pending-claim to a report patch (spread before writing the report).
 * Kept as an explicit helper so the call sites and the reconciliation
 * predicate share the exact key (no string drift).
 */
export const claimSideEffectsPending = <T extends object>(report: T): T & SideEffectsPendingClaim => ({
  ...report,
  side_effects_pending: true,
});

/**
 * Build the report used to clear the claim once all side effects succeeded.
 */
export const clearSideEffectsPending = <T extends object>(report: T): T & SideEffectsClearedPatch => ({
  ...report,
  side_effects_pending: false,
});

/**
 * Reconciliation predicate: does this persisted validation_report carry an
 * UNCLEARED side-effects claim (i.e. the row settled but its downstream side
 * effects may never have run / completed)? Accepts `unknown` — the report
 * column is JSONB and can hold anything from legacy rows.
 */
export const hasPendingSideEffects = (report: unknown): boolean =>
  typeof report === 'object' &&
  report !== null &&
  (report as Record<string, unknown>).side_effects_pending === true;
