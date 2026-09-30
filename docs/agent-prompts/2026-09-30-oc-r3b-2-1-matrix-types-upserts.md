# Agent Dispatch Prompt — R3b 2.1: stream_count + jev_chunk_index types, 2-D persist upserts

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

1. Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-r3b-21` (branch `feat/r3b-2-1-matrix-upserts`, created by CC from `origin/main`). Home dir `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files. If the same test fails twice for the same reason, STOP and report `[BLOCKED]`.
3. No live-DB writes, no migration apply, no deploys, no secrets printed. CC applies migrations (ADR 018).
4. qa-intel findings are NOT advisory (CI fails on them). Fix new-code findings; never baseline new code.
5. Commit when done (no push). Paste `git status --short` first: only the files named below.
6. Negative control for EVERY behavioural test you add: revert the fix → the test fails; paste the output. A test that passes without the fix proves nothing.

---

## 1. Context & Problem Statement

Migration `supabase/migrations/20260930180000_analyses_stream_count_and_chunk_matrix.sql` (branch `feat/r3b-2-contract`, CC applies it before this PR merges) adds `analyses.stream_count integer not null default 5` and `analysis_chunks.jev_chunk_index integer not null default 0` with a new unique key `unique_analysis_chunk_cell (analysis_id, jev_chunk_index, chunk_index)`. The OLD key `unique_analysis_chunk (analysis_id, chunk_index)` is still there because three upserts depend on it: `web/lib/adapters/SupabasePersistenceAdapter.ts` ~L238, ~L503, ~L523 (`onConflict: 'analysis_id,chunk_index'`).

## 2. Contract & Implementation Directives

1. Ledger `[IN_PROGRESS]`.
2. `build-graph`; `query_graph_tool` callers of every function in `SupabasePersistenceAdapter.ts` that writes `analysis_chunks`, and every reader of `analysis_chunks` rows (list them in the report).
3. Add `stream_count` / `jev_chunk_index` to the TypeScript row types that describe `analyses` and `analysis_chunks` (find them — `web/lib/types/**`, `web/lib/ports/AnalysisPersistencePort.ts`; if a generated `database.types.ts` exists, edit the matching fields by hand and say so).
4. Every `analysis_chunks` insert/upsert writes `jev_chunk_index` explicitly (value from the caller; today always `0`) and uses `onConflict: 'analysis_id,jev_chunk_index,chunk_index'`. Add an optional `jevChunkIndex?: number` (default 0) to the port method(s) — no caller passes anything else yet.
5. Every `analysis_chunks` read that keys rows by `chunk_index` alone must also filter/key by `jev_chunk_index` (for now: `= 0`) — list each one you changed, and each one you checked and left, with the reason.
6. Tests in `web/lib/__tests__/`: adapter test asserting the upsert payload carries `jev_chunk_index` and the 3-column `onConflict`; reader test that a row with `jev_chunk_index = 1` is NOT returned where the code expects the K = 1 slice.
7. Write (do NOT apply) `supabase/migrations/20260930190000_drop_legacy_analysis_chunk_key.sql` containing only `alter table public.analysis_chunks drop constraint if exists unique_analysis_chunk;` with a header comment: apply only AFTER this PR's code is deployed.
8. Gates (§4a), qa-intel after `git add`, commit `feat(chunks): 2-D (jev_chunk_index × bundle) persist key`, ledger `[DONE]`.

Out of scope: token, job creation, reduce, finalize/reaper logic (2.2–2.5).

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

> **CC dispatch note (2026-09-30 PM):** the contract migration was renamed from `20260930130000` to `20260930180000`. Production already has `20260930170000`, and CI runs `supabase db push` without `--include-all`, so an older version would be rejected. The worktree was created from current `origin/main`, with the migration and these prompts copied in from `feat/r3b-2-contract`. Leave the migration file as it is: CC applies it and reconciles its version under ADR 018.
