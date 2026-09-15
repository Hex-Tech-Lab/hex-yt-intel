# Agent Dispatch Prompt — ADR 021 Phase 2: Presence-Check-on-Resume

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
> naming this exact task and a parallel sibling task (Phase 3, reaper
> requeue-partial, different files: `web/lib/services/analysis-reaper.ts`).
> Post your own `[IN_PROGRESS]` under that SINK, not a competing one.

---

## 1. Context & Problem Statement

This project (hex-yt-intel) analyzes a YouTube video across 11 "dimensions"
via an LLM cascade, streamed from a Cloudflare Worker to the browser over
SSE, dispatched in 5 parallel "bundles" (each bundle = a group of dimension
numbers, see `web/lib/config/synthesis.ts`'s `STREAM_BUNDLES`).

**Read `docs/private/ADR_021_GRANULAR_PARTIAL_RESUME_AND_REAPER_2026-08-02.md`
in full before writing any code.** It is the authoritative spec for this
task. Summary of what you need:

- **Phase 1 is already done** (2026-08-07): each dimension chunk's LLM result
  is persisted per-chunk via `persistAnalysisChunk` (see
  `web/lib/ports/AnalysisPersistencePort.ts`), which writes
  `analysis_chunks.dimensions_covered` (an `int[]` of which dimension numbers
  that specific chunk actually produced) and `analysis_chunks.payload`. This
  already happens on every chunk completion/interruption — do not touch this
  write path.
- **The gap (your job, Phase 2 of the ADR)**: `findAnalysisChunks({analysisId})`
  (same port, already implemented in `SupabasePersistenceAdapter.ts`, already
  returns `Array<{chunk_index, dimensions_covered, payload, status, ...}>`
  per analysis) has exactly 2 callers today —
  `web/app/api/chat/route.ts` and `web/app/api/analyses/persist/route.ts` —
  and NEITHER is a "what dimensions are already covered, so only re-request
  the rest" check. Verified via `grep -rln "findAnalysisChunks" web/` on
  2026-09-09 — do not assume this has changed without re-checking yourself
  first.
- **Real incident this closes** (see `.memory/AGENT_LEDGER.md`, entries
  around 2026-09-08 20:00-20:35 EEST): analysis `32aeeb78` had 2/5 chunks
  written (`dimensions_covered` non-empty for those 2 rows) before the
  worker died. On restart/retry, the client currently has no way to know
  those 2 chunks already succeeded — it would blindly re-request all 5
  bundles from scratch, wasting the LLM spend already paid for the 2
  completed chunks (this is the exact anti-pattern the research below
  confirms is the wrong approach industry-wide).
- **Industry pattern, confirmed via multi-engine research 2026-09-09** (do
  not re-research this, it's settled — cite these if useful in your own
  comments): "checkpoint, don't blind-retry" is the converged pattern for
  resumable LLM streaming (see e.g. the "Dead Reckoning" resumable-gRPC
  pattern and CTO-Guide resumable-SSE pattern — both: on resume, check what
  was already produced via a durable journal/checkpoint, replay/skip that,
  only regenerate the gap). hex-yt-intel's ADR 021 design already matches
  this — `analysis_chunks.dimensions_covered` IS the checkpoint/journal. You
  are wiring the "check before re-request" half that's missing, not
  inventing a new mechanism.

---

## 2. Contract & Implementation Directives

**Build this as a pure, independently-testable function first, then wire it
in — do not skip straight to changing the resume entrypoint without the
testable core.**

### 2.1 New/extended contract

Add a function (naming your call, but make it self-explanatory), e.g. in
`web/lib/services/` or alongside `AnalysisPersistencePort.ts`'s existing
domain logic (your judgment on file placement — check for an existing
service module this belongs alongside before creating a new file):

```ts
/**
 * Given an analysisId and the full expected dimension count (TOTAL_DIMENSIONS,
 * see web/lib/config/synthesis-with-settings.ts's useTotalDimensions /
 * synthesis.ts's TOTAL_DIMENSIONS), return which dimension numbers are
 * NOT YET covered by any successfully-completed chunk.
 */
async function getMissingDimensionNumbers(
  analysisId: string,
  totalDimensions: number,
): Promise<number[]>
```

- Read via `findAnalysisChunks({ analysisId })`.
- A dimension number counts as "covered" if it appears in ANY chunk row's
  `dimensions_covered` array where that chunk's `status === 'completed'`.
  **Do not count dimensions from `status: 'failed'` or `'interrupted'`
  chunks as covered** — those are exactly the ones that need retrying, even
  if `dimensions_covered` happens to list a partial number for them (read
  `persistAnalysisChunk`'s actual write path in
  `worker/src/services/PersistService.ts` / `atomic-persist.ts` to confirm
  whether an interrupted/failed chunk can still carry a non-empty
  `dimensions_covered` before assuming either way — this is exactly the
  kind of assumption the Three Tenets below require you to verify, not
  guess).
- Return `[]` if `findAnalysisChunks` returns `null` or empty (nothing
  persisted yet — everything is missing, but that's the caller's existing
  fresh-analysis path, not a special case you need to branch on separately
  — just return the correct "all missing" list and let the caller decide).
- No new DB schema, no new Settings Registry key, no new migration — per
  the ADR's own Phase 1 note, existing infrastructure covers this once
  wired together. If you find yourself wanting a new column or endpoint,
  STOP and flag it as a deviation in your report rather than building it.

### 2.2 Wire it into the resume/retry entrypoint

Find where a re-analysis/retry actually decides which bundles to dispatch —
start from `web/hooks/useSSEStream.ts`'s `startAnalysis` (note
`forceRefresh` param) and trace backward to whatever calls it on a "retry a
stuck/partial analysis" path (likely `useAutoRestoreAnalysis.ts`, or the
Synthesis Console's re-analyze button flow in `DashboardContainer.tsx`'s
`handleReanalyze`). **Do NOT change `STREAM_BUNDLES` dispatch logic itself
in `useSSEStream.ts` yet** — that's Phase 4 (a separate, already-scoped,
NOT-yet-dispatched follow-up task; touching it now would create a merge
conflict with that future work). Your scope for Phase 2 is: expose
`getMissingDimensionNumbers` and call it somewhere appropriate on the
resume path to LOG/SURFACE which dimensions are actually missing (e.g. as
a field on the existing status-check response, or a new lightweight
export other code can call) — the actual "only fetch these bundles"
behavior change is explicitly Phase 4's job, not yours. If genuinely
unsure where the line is, err toward NOT touching `useSSEStream.ts`'s
dispatch loop at all and flag the ambiguity in your report instead of
guessing into scope creep.

### 2.3 Tests

- Unit test `getMissingDimensionNumbers` directly: no chunks → all missing;
  some completed chunks covering a subset → exactly the complement missing;
  a `failed`/`interrupted` chunk's dimensions still counted as missing even
  if `dimensions_covered` is non-empty for that row (this is the specific
  edge case most likely to be gotten wrong — write this test FIRST,
  negative-control it by removing your `status === 'completed'` filter and
  confirming the test then fails).
- If you wire it into a resume entrypoint per 2.2, add a test asserting
  that entrypoint actually calls/surfaces it for a partial-chunk fixture.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

Match against your actual final touched-file set, re-matching if it grows:

- **STEP 0**: `build-graph` then `query_graph_tool`/`get_impact_radius_tool`
  if the code-review-graph MCP is connected this session; otherwise fall
  back to `explore-codebase`/`review-delta`/`review-changes` — note which
  you used in your report.
- **ALWAYS**: `qa-intel` (`--mode diff` AND `--mode full`, both, never one
  alone), `code-reviewer`, `simplify`, `review-delta`, `review-duplication`,
  `contract-auditor`.
- Touches `web/lib/**`/`web/hooks/**`/`web/app/api/**`: `race-condition-guard`
  (this IS a shared-state concurrency area — a reaper sweep and a live
  client retry could both read "missing dimensions" and both trigger a
  regenerate for the same dimension concurrently; think about this
  explicitly in your tangent-hunt even though full concurrency handling is
  Phase 3/4's job, not yours — flag it, don't silently ignore it).
- Touches `web/app/api/**`: pr-review-toolkit `type-design-analyzer` if you
  change any type/interface shape (you likely will, on
  `AnalysisPersistencePort.ts` or wherever you place the new function's
  export).

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

Run the exit code of each DIRECTLY — never pipe through `tail`/`grep`/`head`
before checking `$?` (documented recurring mistake, see
`.memory/AGENT_LEDGER.md` 2026-09-07 entry — piping silently discards the
real exit code).

## 4b. Branch / PR

Create branch `feat/adr021-phase2-presence-check`. Commit locally. **Do NOT
open a PR yourself** — CC (this session's orchestrator) will run
`/pr-review-workflow` against your branch once you report `[DONE]`, per the
ledger's Sink pattern (only the Sink orchestrator merges/closes).

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
