# ADR 020: Real Cancellation, Charge-on-Cancel Setting, Cost Ledger, Pricing Registry Migration

**Date**: 2026-08-01
**Status**: Proposed → executing in phases

## Context

Three separate findings converged into one piece of work:

1. **Pricing/tier values are hardcoded in 2+ places** (`MONTHLY_QUOTAS` in `PostgresBillingAdapter.ts` vs. `STRIPE_PRICING` in `stripe.ts`, plus `RATE_LIMITS` in `web/lib/constants/rate-limits.ts`), same drift-risk class as the billing_status CHECK-constraint incident from earlier this session.
2. **Clicking "stop" doesn't stop anything.** `worker/src/routes/analysis.ts:855-866` deliberately passes `undefined` for the client's abort signal into `LLMCascade.executeAndStream`, so generation runs to completion via `ctx.waitUntil` regardless of client disconnect, and persists as `billing_status = 'completed'` anyway. The plumbing to cancel exists in `LLMCascade.callLLMStream` (accepts a `signal`, wires it to its own OpenRouter `AbortController`) — it's just never fed the real signal.
3. **`tokens_used`/`cost_usd` columns exist on `analyses` and `usage_logs` but nothing ever writes to them.** Real OpenRouter spend per analysis is only visible in OpenRouter's own dashboard, not queryable from this DB. The user wants a per-customer cost view in the admin screen (searchable/filterable by user).

Because generation can't actually be stopped today, "charge on cancel" is not currently a real choice — it's the accidental status quo (100% of cancels are already billed, since nothing is cancelled). Real cancellation is a hard prerequisite for the charge-on-cancel setting to mean anything.

## Decision

Build in four phases, each independently shippable and reviewable:

### Phase 1 — Real server-side cancellation (prerequisite)
- Wire the client's real disconnect signal through `worker/src/routes/analysis.ts` into `LLMCascade.executeAndStream`'s `signal` param (reversing the 2026-07-29 deliberate `undefined` — that change avoided a different bug, must confirm it's safe to reverse without reintroducing it).
- On real cancellation, the OpenRouter `fetch` aborts (`LLMCascade.callLLMStream` already supports this), stopping spend immediately.
- Analysis settles to a new terminal state — see Phase 2.

### Phase 2 — `billing.chargeOnCancel` setting + real "cancelled" state
- New Settings Registry key: `billing.chargeOnCancel` (boolean, default `true` per the user's explicit gym-class decision — leaving mid-class still costs the seat).
- New `billing_status` value: `'cancelled'` (distinct from `'failed'` — failed means the system didn't deliver; cancelled means the user chose to stop what would have delivered). Requires a migration to widen the CHECK constraint (learn from the earlier billing_status drift incident: verify the constraint directly, don't trust the TS type).
- `PostgresBillingAdapter.checkGate`'s `activeCount` filter (currently counts `completed` + recent `processing`) extended to also count `cancelled` rows when `billing.chargeOnCancel` is true — single source of truth, not duplicated per-callsite logic.
- Enforcement sites (from the investigation): `PostgresBillingAdapter.ts` (quota count), `analysis-reaper.ts` (must not re-classify a genuinely-cancelled row as plain `failed`), `web/app/api/analyses/persist/route.ts` (writes the terminal `billing_status` — this is where "was this an intentional client cancel" needs to be threaded through from the worker), `dimension-remediation.ts` (must not touch `cancelled` rows — it only targets `failed`, confirm this stays true).
- Same 15-min-vs-30-min grace-window mismatch found during investigation gets fixed in the same migration: both become Settings Registry keys (`billing.quota.processingGraceWindowMs`, reaper's existing window if not already registry-backed) so they can't silently drift apart again.

### Phase 3 — Cost ledger + admin UI
- `LLMCascade`'s OpenRouter streaming response includes `usage` data (need to confirm exact field name/location in the SSE stream — OpenRouter's API returns `usage.total_tokens`/cost info either in a final SSE event or in the non-streaming response shape depending on how the stream is consumed; must verify against OpenRouter's actual docs/response, not assume).
- Parse and persist real `tokens_used`/`cost_usd` onto `analyses` at the same point `billing_status` is finalized (`persist/route.ts`), and log a `usage_logs` row with the real cost (currently `consumeQuota` logs tier+analysisId only, no financial data — extend it).
- New admin route + UI: per-user cost list, searchable/filterable by user (dropdown or search box), showing total analyses, total cost, cost breakdown by status (completed/cancelled/failed) — extends the existing `web/app/admin/users/UsersAdminClient.tsx` (Wave C precedent) rather than building a new surface from scratch.

### Phase 4 — Pricing/tier Settings Registry migration
- Move `MONTHLY_QUOTAS`, `STRIPE_PRICING` display values, `RATE_LIMITS`, feature flags into `pricing.tier.<tier>.*` keys per the naming scheme already approved by the user, collapsing the 2-source (soon 3-source, since Phase 2 also reads quota) drift into one registry-backed read path.
- Stripe `priceId`s stay env-scoped (not registry) per the earlier scoping call — only the display price and enforcement numbers move.

## Execution order

Phase 1 → 2 → 3 → 4, strictly, because each depends on the previous being correct (charging logic needs real cancellation to exist; the cost ledger should capture cancelled-and-charged analyses correctly from day one rather than needing a backfill; the registry migration is lowest-risk and comes last so it doesn't block the higher-stakes billing correctness work).

Each phase: implement → qa-intel + contract-auditor + simplify + owasp-top-10 + supabase-postgres-best-practices (per pr-review-workflow's CORE+SELECT layer) → typecheck → PR → babysit CI to green via /loop → merge → next phase.

## Non-goals / explicit exclusions

- No Stripe metered-billing integration (out of scope, no evidence it's needed yet).
- No refund logic for past cancelled-but-not-charged analyses (this ADR only changes behavior going forward).
- No retroactive cost backfill for already-completed analyses missing `tokens_used`/`cost_usd` (OpenRouter's own dashboard remains the historical source of truth for anything before this ships).
