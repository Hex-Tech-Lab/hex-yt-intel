# Agent Dispatch Prompt — ADR 021 Phase 3: Reaper Requeue-Partial Extension

**Target Agent**: OC (opencode, GLM-5.3-flash)
**Effort Level**: low

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.
>
> A sibling CC session has already posted `[IN_PROGRESS] [SINK: adr021-phases-2-3-presence-check-and-reaper-requeue]`
> naming this exact task and a PARALLEL sibling task (Phase 2, presence-check
> helper, different files: `web/lib/ports/AnalysisPersistencePort.ts` and
> the resume entrypoint under `web/hooks/**`). Post your own `[IN_PROGRESS]`
> under that SINK, not a competing one. **You and the Phase-2 agent are
> running concurrently in the SAME checkout** (per the project's documented
> same-checkout hazard) — your target file (`web/lib/services/analysis-reaper.ts`)
> is disjoint from theirs, so this should not collide, but check
> `git status`/`git diff` before committing anything regardless, and do not
> assume the working tree reflects only your own changes.

---

## 1. Context & Problem Statement

**Read `docs/private/ADR_021_GRANULAR_PARTIAL_RESUME_AND_REAPER_2026-08-02.md`
in full before writing any code.** It is the authoritative spec. Also read
`web/lib/services/analysis-reaper.ts` in full (383 lines) before changing
anything — it already has real salvage machinery from PR #187
(`tryChunkRecovery`, `decideChunkSalvagePolicy`, `chunksAreFullyComplete`,
`MIN_SALVAGEABLE_DIMENSIONS`). **You are extending this existing machinery,
not building a new one** — the ADR is explicit that this is "the existing
binary reaper decision (finalize vs. discard), just evaluated per dimension
instead of per row," not a new decision engine.

Current state (verified 2026-09-09): `ReapOutcome` (line ~66) is typed as
`'completed' | 'failed'` — only two outcomes. The ADR's Phase 3 calls for a
third: **requeue-partial** — when a stuck row has SOME dimensions
successfully persisted (via `analysis_chunks.dimensions_covered`, Phase 1,
already populated) but not enough to finalize, and the row hasn't hit its
retry ceiling, the reaper should be able to mark it for requeue (re-attempt
only the missing pieces) instead of only "finalize with whatever's there"
or "discard entirely."

**Retry ceiling is already resolved and exists** — reuse the existing
Settings Registry key `remediation.maxRetries` (default 3, see
`web/lib/services/dimension-remediation.ts`) and the existing
`remediation_retry_count` field in `validation_report`. **Do not invent a
new retry-ceiling field or Settings Registry key** — the ADR explicitly
resolved this as "no new ceiling invented" (see ADR's "Open questions"
section, item 4).

**Industry pattern, confirmed via multi-engine research 2026-09-09** (do
not re-research, cited for your context): the converged pattern for
partial-failure recovery in resumable streaming/job systems is exactly this
— durable per-chunk checkpoint (`dimensions_covered`, already exists) +
presence-check before any regenerate + a bounded retry ceiling (already
exists here). You're implementing the "reaper acts on the checkpoint"
half.

---

## 2. Contract & Implementation Directives

### 2.1 Extend the type

```ts
export type ReapOutcome = 'completed' | 'failed' | 'requeue-partial';
```

Find every place `ReapOutcome` is consumed (`decideReapOutcome`,
`sweepStuckAnalyses`, and any caller of those — check
`web/app/api/webhooks/reaper` and `web/lib/__tests__/analysis-reaper.test.ts`
for the full consumer list, do not assume you found them all from one grep)
and handle the new variant explicitly at every switch/if-else site — a
default/fallthrough that silently treats `'requeue-partial'` as `'failed'`
or `'completed'` defeats the entire point of adding it.

### 2.2 Decision logic

In the function that currently decides finalize-vs-discard (read
`decideReapOutcome` and `sweepStuckAnalyses` — you'll need to trace which
one actually makes the terminal decision vs. which is a helper), add the
requeue-partial branch:

- Query `analysis_chunks.dimensions_covered` for the stuck row (reuse
  `findAnalysisChunks` from `AnalysisPersistencePort.ts` — **do not write a
  second, parallel query for the same data**; if a sibling Phase-2 agent's
  `getMissingDimensionNumbers` helper already landed by the time you read
  this, USE IT rather than re-deriving the same logic — check
  `.memory/AGENT_LEDGER.md` for a `[DONE]` on the Phase-2 sibling task
  before deciding whether to import it or write your own equivalent; if it
  hasn't landed yet, write the minimal inline equivalent for your own
  needs and note in your report that Phase 2's shared helper should
  eventually replace it — do not block on waiting for it).
- If completed-dimension count is below `MIN_SALVAGEABLE_DIMENSIONS` (the
  existing constant) but above 0, AND `remediation_retry_count` (from
  `validation_report`) is below `remediation.maxRetries`: outcome is
  `'requeue-partial'`.
- If completed-dimension count is 0, or the retry ceiling is already hit:
  fall through to the EXISTING `'failed'`/discard behavior — do not change
  that path's semantics.
- If completed-dimension count already meets `MIN_SALVAGEABLE_DIMENSIONS`
  or more: fall through to the EXISTING `'completed'`/finalize behavior —
  do not change that path's semantics either. Your change is additive
  (a new middle branch), not a rewrite of the existing two.

### 2.3 What "requeue" actually does (scope boundary — read carefully)

**Your scope is the DECISION and its DB-side bookkeeping, not the actual
re-generation trigger.** Phase 4 (client selective bundle dispatch,
`useSSEStream.ts`) is a separate, NOT-yet-dispatched follow-up task that
will consume whatever state you leave behind. Concretely:

- On `'requeue-partial'`, update the row's `validation_report` (or wherever
  the existing reap-outcome bookkeeping already writes — follow the
  existing `'failed'`/`'completed'` write pattern in
  `buildSettlePatch`/`SettlePatch` for consistency, don't invent a
  different write shape for the new outcome) to record which dimension
  numbers are still missing and increment `remediation_retry_count`.
- Do NOT call any LLM/worker endpoint yourself, do NOT change
  `billing_status` to trigger an automatic client-side retry — that
  wiring doesn't exist yet (it's Phase 4's job). Your job ends at "the row
  now correctly records that it's partial-and-retryable, with the specific
  missing dimensions," in a shape a future Phase 4 change can read.
- If you're unsure whether a specific write belongs in your scope or
  Phase 4's, err toward NOT writing it and flag the ambiguity in your
  report — per the Model-tuning rule, guessing into scope you're unsure of
  is worse than flagging it undone.

### 2.4 Tests

- Extend `web/lib/__tests__/analysis-reaper.test.ts` with: a stuck row with
  3/11 dimensions covered, retry count 1/3 → `requeue-partial`; a stuck row
  with 0/11 covered → still `failed` (unchanged behavior, regression-guard
  this explicitly); a stuck row with 3/11 covered but retry count already
  at ceiling (3/3) → `failed`, not `requeue-partial` (the ceiling must
  actually gate it — negative-control this by removing the ceiling check
  and confirming this exact test then fails); a row already meeting
  `MIN_SALVAGEABLE_DIMENSIONS` → still `completed` (unchanged, regression-
  guard).

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

- **STEP 0**: `build-graph` then graph tools if connected; else
  `explore-codebase`/`review-delta`/`review-changes`.
- **ALWAYS**: `qa-intel` (`--mode diff` AND `--mode full`), `code-reviewer`,
  `simplify`, `review-delta`, `review-duplication`, `contract-auditor`.
- `web/lib/services/analysis-reaper.ts` touches shared-state-under-
  concurrency (a sweep is a cron/webhook-triggered job that could overlap
  a live client retry, or the Phase-2 sibling's future Phase-4 consumer) —
  `race-condition-guard` is MANDATORY here, not optional. Specifically
  check: can two overlapping reaper sweeps both decide `requeue-partial`
  and both increment `remediation_retry_count` for the same row (double-
  increment race)? Does `sweepStuckAnalyses`'s existing row-selection
  already guard against processing the same row twice concurrently (read
  its actual `WHERE`/locking clause, don't assume)?
- pr-review-toolkit `type-design-analyzer`: you're changing a public type
  (`ReapOutcome`) — mandatory.

---

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm dlx tsx scripts/verify-quality-engine.ts --mode full
pnpm exec tsx web/scripts/contract-auditor.ts
```

Check exit codes DIRECTLY, never through a pipe to `tail`/`grep`/`head`.

## 4b. Branch / PR

Create branch `feat/adr021-phase3-reaper-requeue-partial`. Commit locally.
**Do NOT open a PR yourself** — CC will run `/pr-review-workflow` once you
report `[DONE]`.

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
