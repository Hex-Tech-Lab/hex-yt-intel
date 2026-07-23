# RCA: BillingStatus Type vs. DB Constraint — 10 Days of Silent Billing-Completion Failures

**Date**: 2026-07-23
**Severity**: CRITICAL (silent, ongoing, financial-adjacent)
**Status**: Fixed, verified end-to-end against live production data (commit `eba3f07f`)

---

## 1. What was found

While investigating a live "stuck analysis" symptom (see
`RCA_2026-07-23_WHY_CONTRACT_AUDIT_MISSED_KG_SCALE_BUG.md` for the sibling
incident that led here), a fix for the stuck-analysis reaper hit a real
Postgres `CHECK` constraint violation. Pulling the actual constraint and the
real distribution of `billing_status` values across the table revealed:

```sql
-- The ACTUAL, enforced constraint (since migration 20260611183500):
CHECK (billing_status = ANY (ARRAY['processing', 'completed', 'failed']))

-- The real data:
billing_status | min(created_at)       | max(created_at)       | count
processing     | 2026-07-10             | 2026-07-23 (today)    | 14
failed         | 2026-05-15             | 2026-07-23 (today)    | 78
completed      | 2026-06-04             | 2026-07-13            | 45
```

**No analysis has successfully reached `billing_status = 'completed'` since
2026-07-13** — ten days before this was found. The 45 historical `completed`
rows are entirely artifacts of the migration's own one-time backfill; none
came from live traffic since.

## 2. Root cause

The app-wide `BillingStatus` TypeScript type
(`web/lib/types/validation-report.ts`) declared:

```ts
export type BillingStatus = 'pending' | 'chargeable' | 'charged' | 'failed';
```

This has **never** matched the database. Every successful analysis
finalization (`SupabasePersistenceAdapter.updateAnalysisResult`, the
reaper's `buildSettlePatch`) computed and wrote the literal `'chargeable'`
on success — which the `CHECK` constraint has rejected on every attempt
since the constraint was added, six weeks before this session. The write
throws, the exception is caught, and the row is left at whatever
`billing_status` it had before (usually `'processing'`) — an unversioned,
silent failure mode with no user-facing error and (per the app's Sentry
setup, which this session couldn't access to confirm) presumably only a
logged exception, easy to miss in aggregate noise.

`'charged'` was never written by *any* code path — grepped the entire
codebase and found zero write sites. No Stripe webhook or payment-collection
use case exists that would transition a row from `chargeable` to `charged`.
The 4-state model was aspirational scaffolding, not a real requirement.

**Confirming evidence the 3-state model is correct, not the 4-state one**:
`BillingPersistencePort.updateBillingStatus`'s parameter was *already*
correctly typed `'processing' | 'completed' | 'failed'` in one place in the
codebase — direct proof that someone, at some point, modeled this exact
field correctly, and it was simply never reconciled with the
`validation-report.ts` type used everywhere else. Two contracts for one
concept, never unified — the same pattern as the KG-schema/persona-id
incident earlier tonight, just on a much higher-stakes field.

## 3. A second, related contract failure found in the same investigation

Migration `20260722000000_history_overview_function_v4.sql` — the "A3 fix"
from the roster, previously reported "verified live" — contains this
comment:

> *v3's status CASE checked `billing_status = 'completed'`, but 'completed'
> is not a valid billing_status value anywhere in the app*

This claim is **factually wrong** (verified directly against the live
schema). v4 changed v3's actually-correct check
(`billing_status = 'completed'`) into `billing_status IN ('chargeable',
'charged')` — values that can never exist in that column. v3 was right; v4
"fixed" a working check into a permanently-broken one by trusting a
TypeScript type over the deployed schema, without ever querying the real
constraint. This is the exact same audit-methodology gap documented in the
KG-schema RCA: **trusting code-level types as ground truth instead of
verifying against the actual, deployed database contract.** New migration
`20260723120000_history_overview_function_v5.sql` reverts to the correct
check.

## 4. Why this went unnoticed for 10 days

Two masking factors, both found during the fix:

1. `SupabaseAnalysisAdapter.ts` had a `validation_passed` boolean fallback
   alongside the (dead) `billing_status === 'chargeable' || 'charged'`
   check: `if (billing_status === 'completed' || !!validation_passed) return
   'completed';`. Since `validation_passed` is set by a *separate* write
   inside the same failed transaction/request in some code paths, some
   analyses likely still displayed as complete in the UI via this fallback
   even while their `billing_status` silently stayed wrong underneath —
   masking the symptom from casual observation.
2. The failure is silent by design (caught exception, no user-facing
   error) and the affected field (`billing_status`) isn't directly visible
   anywhere in the product UI — only its *derived* "complete/partial/failed"
   status is, and that derivation had its own fallback (above) partially
   compensating.

## 5. Fix

Collapsed `BillingStatus` to the DB's real, 6-week-battle-tested 3-state
contract (`'processing' | 'completed' | 'failed'`) instead of widening the
schema to match a speculative 4-state type nothing implements. Rationale
(researched, not assumed): billing/invoice state machines in real systems
(Stripe, Chargebee, AWS) only grow additional intermediate states when
there's genuine payment-processing complexity to track (retries, partial
payment, invoicing lag) — none of which exists in this per-analysis-credit
model. Adding states nothing consumes is premature complexity, not a
correctness requirement.

Fixed every write and read site (full list in commit `eba3f07f`):
`SupabasePersistenceAdapter.updateAnalysisResult`, the new shared
`stitch-analysis-chunks.ts`'s `buildDimensionStatus`, `analysis-reaper.ts`'s
`buildSettlePatch`, and three now-dead `'chargeable' || 'charged'` OR-checks
(`SupabaseAnalysisAdapter.ts`, `analyses/[id]/route.ts`,
`analyses/check/route.ts`) collapsed to the single real value.
`BillingPersistencePort` now imports the canonical type instead of keeping
its own separate (but coincidentally correct) inline literal.

## 6. Verification (not just unit tests — live production data)

- Replayed the actual stuck analysis's real chunk payloads offline against
  the fixed schema/stitching before touching anything live.
- Ran the real `sweepStuckAnalyses` reaper against the live database.
  Result: the genuinely chunk-complete stuck analysis
  (`1cbff963-2cdc-42d7-9a49-7066afaf56e8`) was correctly recovered —
  `billing_status: completed`, `validation_status: done`, 11/11 dimensions,
  `reaped_via: chunk_recovery`, full markdown (31,670 chars, byte-identical
  to the offline replay). A *different* stuck row with genuinely-incomplete
  chunks (4 real dimension timeouts, unrelated cause) correctly fell through
  to the old markdown heuristic and landed `failed` — proving the new
  recovery path doesn't misfire on genuinely incomplete work.
- Zero rows remained stuck in `processing` after the sweep (started at 14).
- Full vitest suite (859 tests, +6 new edge-case tests for the reaper's
  chunk-completeness gate), type-check, lint, and qa-intel all clean (0
  high/critical findings; only pre-existing style-only low findings).

## 7. Tangent found, not fixed (logged for follow-up)

`BillingPersistencePort.updateUserTier`'s parameter type (`'pro' | 'free'`)
is narrower than the canonical `UserTier` type (`'free' | 'pro' |
'enterprise'`) — there is no code path that can ever programmatically write
`'enterprise'` via this port. Unlike the billing_status bug, nothing
currently *tries* to write `'enterprise'` and fails, so this is a capability
gap, not an active silent failure. Left for a dedicated follow-up rather
than fixed under this incident's time pressure.

## 8. Standing lesson (third occurrence of the same pattern this session)

This is the third time tonight the same failure mode has appeared: a
TypeScript type treated as ground truth, never cross-checked against the
actual deployed contract (Zod schema, prompt literal, or here, a DB `CHECK`
constraint). See `feedback_10x_self_critique_before_implementing.md`
(memory) and the KG-schema RCA's Wave B (`docs/history/
RCA_2026-07-23_WHY_CONTRACT_AUDIT_MISSED_KG_SCALE_BUG.md` §6) — this
incident is a second concrete instance of exactly the missing audit
category described there: automated cross-checking of TS-type-vs-real-
schema/constraint pairs, not just endpoint-to-endpoint shape contracts.
