# Lane E — Security, Concurrency & Decision-Risk Stress Test

Scope: `ba94b9bf..HEAD`, billing/entitlements/auth + concurrent-mutation code. Skills invoked: owasp-top-10, race-condition-guard, stress-test, llm-council.

## OWASP Top 10 — billing/entitlements (`32175b5b`/#285)

`web/app/api/billing/entitlements/route.ts`: **clean**. Uses `supabase.auth.getUser()` (server-verified, not `getSession()`/client-trusted), fails closed (401 on auth error, 503 not cached-as-free on outage). `useEntitlements.ts` client hook now strips `user_metadata` and resets state on auth-change/user-switch (activeUserIdRef guards stale-response application) — this is a genuine fix for a real client-side trust bug (formerly derived tier from client-writable metadata), confirming #285 fixed what #284 flagged. **#284's concern is fully closed**, not partial.

## Race-Condition-Guard — real finding (not theoretical)

**`web/lib/adapters/PaddleBillingAdapter.ts:130-146` and `:240-256`** — classic TOCTOU / check-then-act. Both `processSubscriptionEvent` and `processTransactionEvent` do:
```
SELECT updated_at WHERE paddle_subscription_id = X   (check)
...
UPSERT ... ON CONFLICT (paddle_subscription_id)        (act)
```
with no transaction, row lock, or DB-level ordering constraint between the two statements. Paddle explicitly documents webhook redelivery and does not guarantee in-order delivery. **Failure scenario**: two webhook events for the same subscription (e.g. `subscription.updated` with `occurred_at=T2` and a redelivered/retried older `subscription.updated` with `occurred_at=T1 < T2`) arrive concurrently. Both requests execute the SELECT before either UPSERT commits — both see the same `existing.updated_at` (pre-T1), both pass the staleness check, and whichever UPSERT commits last wins regardless of `occurred_at`. If T1's request commits after T2's, the subscription silently regresses to stale plan/status data (e.g. a cancellation reverts to active, or a downgrade reverts to a stale higher tier) until the next event self-corrects it. This is a **real, exploitable-by-timing** race, not a hypothetical — Paddle's own retry behavior under load or a slow DB round-trip is sufficient to trigger it. Not caught by existing tests (`paddle-e2e-billing.integration.test.ts` wasn't inspected for concurrent-delivery scenarios in this pass — flag to verify).

Fix direction (not applied, report-only): move the staleness check into the upsert itself via a conditional write (`UPDATE ... WHERE updated_at < eventOccurredAt` unioned with an insert-if-absent, or a Postgres `INSERT ... ON CONFLICT DO UPDATE ... WHERE excluded.updated_at > user_subscriptions.updated_at`), making the whole operation atomic instead of split across two round-trips.

Highlights budget / KG entity-accumulation: no comparable race found — those are synchronous, single-request compute paths (not concurrent-webhook-shaped), consistent with audit's "not a duplicate merge" finding on `df4baea3`/`96151a74`.

## Stress-test — sharpest challenge to the first-pass report

The first-pass report's line *"Migration ... claims live-DB EXECUTE-grant verification ... could not be independently re-confirmed"* under-states its own implication: an **unverified security-relevant grant on an admin RPC is a live risk sitting in the report as a footnote, not flagged at the severity it deserves.** If that grant is wrong (e.g. broader than `service_role`/`postgres`), it's a privilege-escalation surface, not a hygiene note. Recommend re-classifying that item from "residual risk" to at least **Medium**, pending live verification — the report currently ranks it below items with less blast radius (e.g. the #273/#274 duplicate-title PR check).

Verbalized-sampling on the Paddle/entitlements work produced 3 independent framings that converge: (1) a correctness-first reviewer calls it a solid, well-scoped fix; (2) a security-first reviewer flags the TOCTOU above as the one gap; (3) an ops-first reviewer notes the webhook path has no dead-letter/replay-safety story beyond the timestamp check, i.e. the TOCTOU isn't just a race but the *only* line of defense against replay/reordering, so its failure mode isn't "unlikely edge case," it's "the one thing standing between here and stale-billing-state," which raises its severity above race-condition-guard's default classification.

## llm-council — second opinion on the TOCTOU finding

Council-style synthesis: convergent verdict that this is a **real, shippable-today concurrency bug** with **Medium-High** confidence (not Critical, because the self-correcting nature of subsequent events limits blast radius to a transient window, typically resolved by the next webhook for the same subscription) and **Medium** urgency (fix before scaling webhook volume, not necessarily before next deploy). Dissent noted: one framing argues Paddle's webhook delivery is HTTP-serial-enough in practice that this rarely triggers — treat as **unverified assumption**, not a reason to deprioritize, since the fix is cheap (one SQL predicate) relative to the cost of a billing-state bug reaching a paying customer.

## Findings by severity

| Sev | Finding | Evidence |
|---|---|---|
| High | Paddle webhook TOCTOU race (subscription + transaction event handlers) | `PaddleBillingAdapter.ts:130-146`, `:240-256` |
| Medium (reclassified up) | Admin RPC EXECUTE grant claimed-not-independently-reverified | `20260829011500_admin_list_users_activity_grant_authenticated.sql` (carried from first-pass report) |
| Low | No dead-letter/replay audit trail for rejected/stale webhook events (only a console.info) | `PaddleBillingAdapter.ts:144`, `:254` |
| Info | ~20 stale `.claude/worktrees/agent-*` directories containing old `paddle.ts` copies still on disk | out of Lane E scope, flagged for whichever lane owns repo hygiene |

Counts: 1 High, 1 Medium (reclassified from the first report), 1 Low, 1 Info/out-of-scope note.
