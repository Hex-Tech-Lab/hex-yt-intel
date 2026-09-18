# Agent Dispatch Prompt — Fix PR #314 (fix/pr312-review-findings) review findings: CAS race, primitive-payload crash, CI failures

**Target Agent**: OC (opencode, GLM 5.3 Flash, low effort)
**Effort Level**: low (well-scoped, narrow findings — matches CLAUDE.md's routing table for OC's cheap default)

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

---

## 1. Context & Problem Statement

PR #312 shipped (merged to main). A post-merge review of a follow-up branch
(`fix/pr312-review-findings`, this worktree, currently at commit `0d789958`
after a merge with `main`) found real gaps in `web/app/api/analyses/persist/route.ts`'s
malformed-chunk reclassification and atomic parent-finalization logic. This
branch already has SOME fixes (`d34b50ec` "atomic parent finalize, terminal
failed rows for malformed chunks, settled-stitch reclassification") but a
second review round on that exact commit found further real gaps in what it
shipped, plus 2 currently-FAILING CI checks (`CodeFactor`, `DeepSource:
JavaScript (web)`) that are gate-blocking (NOT the usual pre-existing/
informational-only class documented in this repo's THOS handovers — these
are real findings introduced by this branch's own diff).

You are fixing the SECOND review round's findings on TOP of what's already
in this branch — do not revert or redo the existing `d34b50ec` work, extend it.

## 2. Contract & Implementation Directives

Work in this worktree (already checked out, already merged with main, no
conflicts): `.claude/worktrees/oc-pr312-review-findings`, branch
`fix/pr312-review-findings`. Do NOT create a new branch or worktree.

### P0 — `markChunkFailed()` race condition (data loss)
Files: `web/app/api/analyses/persist/route.ts`, `web/lib/adapters/SupabasePersistenceAdapter.ts`, `web/lib/ports/AnalysisPersistencePort.ts`.

**Problem**: `markChunkFailed()` is guarded only by `(analysis_id,
chunk_index, status='completed')`. A concurrent writer can replace the
malformed `completed` row with a VALID `completed` payload before this
demotion runs. The route then demotes the now-valid row and unconditionally
deletes it from the in-memory `chunkMap` regardless of whether the CAS
actually matched the row it read, or whether the DB call itself errored.

**Fix**:
1. Pass an observed row version to `markChunkFailed` — a DB revision column
   if one exists, otherwise `updated_at` + a payload/version fingerprint
   (e.g. a hash of the malformed payload) — so the UPDATE only fires when the
   row is STILL the exact malformed row you read, not just still `completed`.
2. On a CAS miss (0 rows updated), refetch the row: if it's now a valid
   completed payload, restore it into `chunkMap` rather than treating the
   miss as "someone else already handled it." Only delete the `chunkMap`
   entry after a CONFIRMED demotion (CAS matched, row is now `failed`).
3. On an unknown/thrown DB error from the demotion call, do NOT silently
   delete the `chunkMap` entry — log it, leave the entry in whatever state
   accurately reflects "we don't know," and make sure the parent-finalize
   path treats an indeterminate chunk as not-yet-settled rather than
   proceeding as if it were handled.

### P1 — primitive JSON payload crashes settled-stitch
File: `web/app/api/analyses/persist/route.ts`.

**Problem**: the settled-path malformed filter runs `'dimensions' in
chunk.payload`. Runtime JSON can be a primitive (string, number, boolean,
null) since `AnalysisPersistencePort`'s `payload` field is typed
`Record<string, unknown>` but that's a compile-time lie about what the DB
can actually contain — the `in` operator throws a TypeError on a primitive
left-hand target.

**Fix**:
1. Guard with `typeof payload === 'object' && payload !== null` BEFORE any
   property check.
2. Add a shared predicate, e.g. `hasUsableDimensionsPayload(payload: unknown): payload is { dimensions: ... }`,
   used everywhere this check happens, not just inline at one call site.
3. Consider (only if low-risk/mechanical) widening the persistence port's
   `payload` type from `Record<string, unknown>` to `unknown` so future
   callers can't make the same false assumption — do this ONLY if it doesn't
   cascade into unrelated type-error fixes across many files; if it does,
   leave the port type as-is and rely on the predicate function instead, and
   say so explicitly in your report.
4. Add tests: string, number, boolean, `null`, `{}`, `{foo:'bar'}`, and a
   valid `{dimensions:{...}}` payload — assert each is classified correctly
   and none of them throw.

### P1 — clear the 2 failing CI gates (CodeFactor, DeepSource)
This is a REAL gate-blocking failure on THIS branch's diff (not the usual
pre-existing/informational noise this repo tolerates — confirm this via
`gh pr checks` before assuming otherwise). Root causes reported:
- Mock classes with constructors returning objects (in the new route tests
  and adapter tests) — replace with plain object literals or `vi.mock`
  factory functions.
- Global-scope function declarations flagged by DeepSource.
- Redundant explicit `undefined` arguments.
- Non-null assertions (`!`) — replace with real narrowing.
- Empty arrow functions.
- `!!count` — replace with `Boolean(count)`.
- `markChunkFailed` trips a class-method `this`-usage lint rule — restructure
  so the method body doesn't fake `this` usage just to satisfy the linter;
  find the real idiomatic fix (may mean it should be a plain function, not a
  class method, if it doesn't actually need instance state).

Fix these WITHOUT changing runtime behavior. Re-run `gh pr checks 314` (or
push and re-check) to confirm both gates go green.

### P2 — malformed vs payload-less log misclassification (do this too, it's cheap)
File: `web/app/api/analyses/persist/route.ts`.

**Problem**: `isPayloadlessChunk` is defined as `!validPayload`, so a
malformed-but-truthy object (e.g. `{}`, `{foo:'bar'}`) is ALSO classified as
"payload-less" in logs — it should be "malformed-object" instead. Never
observably reaches the "malformed-object" log branch.

**Fix**: make the classification mutually exclusive — e.g.
`chunkPayloadMalformed ? 'malformed-object' : 'payload-less'` (or define
explicit, non-overlapping classification values before routing). Add a log-
reason assertion in a test.

### P2 — auxiliary-status one-shot retry guard set too early (only if time permits after P0/P1/CI)
File: `web/hooks/useAuxElementStatus.ts`.

**Problem**: moving the guard-consumption after success fixed StrictMode
double-invoke and unmount-cancellation, but an ORDINARY (non-StrictMode)
rejected/non-OK fetch never schedules a retry or changes dependencies — the
hook can stay stuck on the live stub until an unrelated remount.

**Fix**: schedule exactly ONE bounded retry after a failed fetch (not
unbounded, not on permanent failures), with cleanup-cancellation on unmount
or analysis-id change, and a per-analysis retry-consumed guard so it doesn't
loop. Add a normal-mount (non-StrictMode) failed-then-success test, not just
StrictMode-mode tests.

## Negative-control tests — MANDATORY, every fix above

For the P0 CAS fix specifically: write a test that simulates the exact race
(malformed row replaced by a valid row between read and demote-write) and
prove the OLD code would have wrongly demoted/discarded the valid payload,
then prove the FIXED code preserves it. This is not optional — a fix without
a negative control that reproduces the original bug is not considered done.

For the P1 primitive-payload fix: prove the OLD `'dimensions' in payload`
check actually throws on a string/number/boolean/null payload (a raw
`expect(() => oldCheck(...)).toThrow()`-style assertion, or equivalent
before/after comparison), then prove the fix handles all of them without
throwing.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

Match against the LIVE skill list via `ls ~/.claude/skills .claude/skills` —
do not recall from memory. At minimum, given the touched files:
- **ALWAYS**: `qa-intel` (BOTH `--mode diff` AND `--mode full` — never trust
  one mode alone), `code-reviewer`, `simplify`, `review-delta`,
  `review-duplication`, `contract-auditor`.
- **BE/API** (`web/app/api/**`, `*adapters*`, `*ports*`): `race-condition-guard`
  (this task IS a concurrency/TOCTOU fix — mandatory, not optional here),
  `silent-failure-hunter` (error-handling paths touched).
- Also run `build-graph`/`get_impact_radius_tool` (Step 0) before editing, to
  confirm no other caller of `markChunkFailed` or the persistence port
  methods you're touching is missed.

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm dlx tsx scripts/verify-quality-engine.ts --mode full --ci
pnpm exec tsx web/scripts/contract-auditor.ts
```

## 4b. External CI

Push to `fix/pr312-review-findings` (PR #314, already open) and check
`gh pr checks 314` — confirm CodeFactor and DeepSource specifically go green
(they are the two currently-failing gates), and confirm no NEW failures
appear that weren't there before your push.

---

## 5. The Three Tenets — [ALWAYS INCLUDE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

## 6. Report Format — [ALWAYS INCLUDE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

Additionally, for CC's qa-intel follow-up wave: explicitly flag in your
report which of these bug classes (CAS-without-exact-row-version,
primitive-JSON-crashes-optimistic-type, mutually-non-exclusive log
classification) are GENERALIZABLE enough to become a qa-intel static-analysis
rule vs. one-off — CC will use this input when designing new rules, don't
design the rule yourself, just flag the candidate pattern and where else in
the codebase it might recur (a quick grep is enough, not a full audit).

Do NOT merge or close the PR yourself — CC is sink orchestrator, push to the
branch and report, CC verifies against real sources and merges.
