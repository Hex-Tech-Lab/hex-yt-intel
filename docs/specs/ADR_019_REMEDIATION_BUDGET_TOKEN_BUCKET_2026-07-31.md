# ADR 019: Remediation Budget — Dollar-Denominated Token Bucket

Status: ✅ Implemented. See CLAUDE.md ADR ledger entry 019.

## Context

`remediate-missing-dimensions` (design predecessor:
`docs/specs/remediate-missing-dimensions-design.md`) regenerates missing
dimensions for analyses stuck partial. The original execution model used a
Redis mutex lock (one harness run at a time) plus a fixed candidate limit
per tick (3), sized to fit inside a Vercel `maxDuration` budget.

Live-checked against OpenRouter's actual account API
(`GET /api/v1/auth/key`, 2026-07-30):

```json
{ "limit": 110, "limit_remaining": 69.52, "rate_limit": { "requests": -1, "note": "deprecated, safe to ignore" } }
```

**OpenRouter exposes no hard concurrency limit.** The real constraint on
this account is a $110/month spend cap, shared with live paying traffic.
A fixed batch size or concurrency count doesn't protect that budget —
it protects against the wrong thing. It also fails the actual product
requirement: fix partial analyses fast (revenue is blocked on delivery —
"we do not charge until we deliver"), without burning the shared monthly
pool needed for live customer traffic.

## Decision

Replace the mutex-lock + fixed-batch model with a **dollar-denominated
token bucket**, and replace every previously-hardcoded number with a
Settings Registry key (`setting_definitions`/`setting_values`, the same
mechanism `analysis.maxOutputTokens.*` and `cascade.analysis` already use
— `SupabaseSettingsAdapter.getRegistrySettings`). No tunable in this
feature is a literal constant.

### Token bucket mechanics

- **Capacity** (USD, cents) = `min(budgetPercentOfRemaining% × OpenRouter's live remaining balance, hardCapUsdCents)`. `hardCapUsdCents = 0` means no hard cap — percentage alone governs. The live remaining balance is re-fetched periodically (not a one-time snapshot), so a manual top-up raises the ceiling automatically without a config change.
- **Refill rate** = `capacity / periodDays` (USD/day), continuous — the bucket refills a little every check, not in a discrete monthly cliff.
- **Burst is free, not a separate parameter.** A full bucket (start of period, or after idle time) can spend up to its entire capacity immediately — this is "fix it fast." As tokens deplete, spend throttles down to the steady refill rate. The ratio of capacity to refill rate *is* the recency bias; no 4th knob needed.
- **Concurrency ceiling falls out of the budget, not a picked integer.** However many candidates the bucket can currently afford is exactly how many run in parallel this cycle.
- Implemented as an atomic Redis Lua script (reusing `executeRedisScript`, the same primitive `RedisTrafficAdapter.ts`'s sliding-window rate limiter already uses — same infra, different algorithm) so concurrent invocations can't double-spend the same tokens.

### Settings Registry keys (`remediation.*`)

| Key | Seed default | Meaning |
|---|---|---|
| `remediation.enabled` | `true` | Kill switch, no redeploy needed |
| `remediation.budgetPercentOfRemaining` | `10` | % of OpenRouter's live remaining monthly balance |
| `remediation.hardCapUsdCents` | `200` ($2.00) | Absolute ceiling regardless of percentage; `0` = unlimited |
| `remediation.periodDays` | `30` | Refill window, matches OpenRouter's own monthly reset cadence |

All four are live-editable from the settings page immediately, same as
every other registry-backed tunable — never hardcode a replacement
constant at the call site.

### Candidate selection: "pendulum"

Alternates oldest-first and newest-first each poll cycle (toggle stored
alongside the bucket state), rather than pure FIFO or pure LIFO. Pure
oldest-first can starve a fresh, still-blocking failure behind a long
queue; pure newest-first can permanently starve an old one. Alternating
guarantees every candidate is eventually reached from both directions.

### OpenRouter-distinguishable identity

Remediation worker calls tag OpenRouter's `user` field as
`remediation:<analysisId>` instead of a real end-user id (the same field
live traffic already populates with `userId`, per the 2026-07-30
correlation work). This is what makes "how many of the partial-analysis
population actually got fixed" answerable directly from OpenRouter's own
dashboard, not just inferred from our DB — a concrete before/after metric
against the ~25% partial-rate baseline (itself likely inflated by this
session's own dev-cycle churn, expected to drop once the system is
stable).

### What did NOT change

- **Persistence stays as originally built**: `stitchChunksIntoPayload` +
  `SupabasePersistenceAdapter.updateAnalysisResult` directly, not routed
  through `/api/analyses/persist` (920 lines, deeply coupled to the live
  5-bundle-stream flow's billing/quota/WorkflowConductor sequence —
  reusing it for a patch-an-already-settled-row operation risks
  double-billing or quota re-deduction; verified by reading the route
  before deciding, not assumed).
- **Execution still runs synchronously on Vercel** (fetches the worker's
  SSE stream and waits), not as a native CF Worker Cron Trigger. ADR 005
  ("the worker stays DB-access-free" — confirmed via
  `WorkerPromptConfigAdapter.ts`'s own header comment, documenting a real
  past incident, `HEX-YT-INTEL-3D`, from a prior attempt to give the
  Worker Supabase access) rules out moving candidate-finding or
  persistence into `worker/src`. The fully-decoupled version — Worker
  generates and POSTs its result back via its own S2S mechanism
  (`PersistService.ts`'s existing pattern), Vercel never waits — is the
  architecturally cleaner end state but is a larger change (new Worker
  route, new Vercel receiving endpoint) explicitly deferred: flagged as
  future work, not built now, given competing priorities.
- **`maxDuration=300` on the webhook route stays.** With budget (not a
  fixed batch count) as the real gate, a cycle naturally stops early once
  the bucket is empty — the duration budget is a safety ceiling, not the
  primary pacing mechanism anymore.

## Consequences

- Every number in this feature is now inspectable and changeable from
  the settings page without a deploy or a PR.
- Throughput scales with backlog size automatically: an empty bucket
  self-throttles, a full one clears fast — no "3 every 30 minutes"
  regardless of whether there are 45 or 4,500 candidates waiting.
- The dependency on OpenRouter's `/api/v1/auth/key` endpoint for live
  balance is itself an `UNVERIFIED_ENDPOINT_NO_TEST`-class risk
  (undocumented management API, per contract-auditor's existing rule
  philosophy) — if it ever 404s or its shape changes, the bucket must
  fail closed (zero capacity, not unlimited) rather than silently
  assume unlimited budget.
