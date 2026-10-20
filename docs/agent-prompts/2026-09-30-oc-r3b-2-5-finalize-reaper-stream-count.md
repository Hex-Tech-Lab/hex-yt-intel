# Agent Dispatch Prompt — R3b 2.5: persist/finalize/reaper/R2b gate read stream_count + the 2-D matrix

**Target Agent**: OC (`glm-preset/@preset/glm-53-flash-on-cheap`, CLAUDE.md "OC model standard")
**Effort Level**: medium
**Series**: R3b step 2 (ADR 037 Addendum A, private doc `docs/private/ADR_037_JEV_SEMANTIC_CHUNKING_VARIANCE_BOUNDARIES_2026-09-29.md` — read Addendum A in full). Dispatch ONE at a time, in order 2.1 → 2.5; each starts from `origin/main` after the previous one merged.

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
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

---

---

## HARD RULES

1. Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-r3b-25` (branch `feat/r3b-2-5-finalize`, created by CC from `origin/main`). Home dir `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files. If the same test fails twice for the same reason, STOP and report `[BLOCKED]`.
3. No live-DB writes, no migration apply, no deploys, no secrets printed. CC applies migrations (ADR 018).
4. qa-intel findings are NOT advisory (CI fails on them). Fix new-code findings; never baseline new code.
5. Commit when done (no push). Paste `git status --short` first: only the files named below.
6. Negative control for EVERY behavioural test you add: revert the fix → the test fails; paste the output. A test that passes without the fix proves nothing.

---

## 1. Context & Problem Statement

Completeness is hardcoded to `TOTAL_STREAMS = 5` (`web/lib/config/synthesis.ts` L12) in: persist Zod `chunkIndex max(TOTAL_STREAMS)` / `totalChunks === TOTAL_STREAMS` (`web/app/api/analyses/persist/route.ts` ~L211–213), `resolvedTotal` ~L415, received-set checks ~L668/L688, chunk map ~L759; the reaper (`web/lib/services/analysis-reap-policy.ts` ~L114–125 "all chunks present", `web/lib/services/analysis-reaper.ts` ~L218 `stitchChunksIntoPayload(chunkMap, TOTAL_STREAMS)`); and the R2b gate (`web/lib/usecases/ProjectiveContextUseCase.ts`, keyed by `chunk_index` ~L91). Addendum A2/A4: completeness = every expected `(jev_chunk_index, chunk_index)` cell present, count = `analyses.stream_count`; the reduce (2.4) runs before the projective gate releases.

## 2. Contract & Implementation Directives

1. Ledger `[IN_PROGRESS]`. `build-graph`; `query_graph_tool` every reader of `TOTAL_STREAMS` and of `chunk_index` — paste the full list; each one must be changed or explicitly justified as bundle-only.
2. A single pure helper `expectedCells(streamCount, bundles): {jevChunkIndex, chunkIndex}[]` (K = (streamCount − P) / G; throw on a non-integer K) in `web/lib/config/synthesis.ts`; every completeness check uses it. `TOTAL_STREAMS` remains only as the legacy default.
3. Persist: accept `jevChunkIndex` (0..K−1) and validate `chunkIndex`/`totalChunks` against the row's `stream_count` (loaded server-side, never trusted from the body).
4. Finalize + reaper: "complete" = all expected cells present; K > 1 ⇒ run `reduceGroundedChunks` (2.4) over the grounded cells before stitching; K = 1 ⇒ exactly today's path (regression test with a real 5-chunk fixture must be byte-identical to `origin/main` output).
5. R2b gate: 409 until every grounded cell for every jev chunk is persisted; the signed context is built from the REDUCED grounded result.
6. Tests: K = 1 byte-identical regression (finalize and reaper); K = 3 complete; K = 3 with one missing cell ⇒ not complete, and the reaper requeues only that cell (ADR 021); persist rejects `jevChunkIndex >= K`; gate 409 with a missing cell.
7. Gates, commit `feat(finalize): stream_count-driven completeness over the Jev matrix`, ledger.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

Use `docs/agent-prompts/TEMPLATE.md` §3 verbatim (newest list). Re-match SELECT whenever the touched-file set grows. Write "not available in OC" for any skill you cannot invoke — never claim it ran.

---

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```
---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
