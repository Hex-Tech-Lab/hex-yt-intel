# Agent Dispatch Prompt — R3b 2.3: compute K + stream_count + cost cap and dispatch the matrix — BLOCKED on a design decision (see §1)

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

1. Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-r3b-23` (branch `feat/r3b-2-3-plan`, created by CC from `origin/main`). Home dir `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files. If the same test fails twice for the same reason, STOP and report `[BLOCKED]`.
3. No live-DB writes, no migration apply, no deploys, no secrets printed. CC applies migrations (ADR 018).
4. qa-intel findings are NOT advisory (CI fails on them). Fix new-code findings; never baseline new code.
5. Commit when done (no push). Paste `git status --short` first: only the files named below.
6. Negative control for EVERY behavioural test you add: revert the fix → the test fails; paste the output. A test that passes without the fix proves nothing.

---

## 1. Context & Problem Statement

> **CC GATE — DO NOT DISPATCH UNTIL THE USER CHOOSES AN OPTION BELOW.**
> Addendum A2 says `stream_count` is written "once, at job creation". Verified 2026-09-30: `web/lib/usecases/CreateAnalysisUseCase.ts` only sometimes has the transcript (`ingestionResult.transcript`, ~L253/L393); otherwise the Edge Worker fetches it during the SSE stream (~L150 comment, `worker/src/routes/analysis.ts` `fetchTranscriptIfMissing` ~L648). K needs the transcript, so it cannot always be computed at job creation.
> - **Option P1 (recommended): plan endpoint.** New `POST /api/analyses/[id]/plan` (Vercel, S2S-HMAC like `/persist`). Called by the worker right after the transcript is known (or by job creation when it already has it). It runs `chunkTranscript` + the A6 cost cap, writes `analyses.stream_count` once (conditional update `where stream_count = 5 and <no plan yet>`, idempotent), and returns the cell list with per-cell v2 tokens (2.2) and slice signatures. The first bundle stream stays as today; the client then opens the remaining cells from the plan.
> - **Option P2: fetch the transcript on Vercel before job creation** (move/duplicate `TranscriptExtractor` logic to Vercel). Simplest contract, but duplicates the provider chain and adds latency before the first byte (ADR 005/032 trade-off).
> - **Option P3: K = 1 whenever the transcript isn't known at job creation**, Jev only for cached transcripts. No new endpoint, but map-reduce silently never runs for fresh videos.

## 2. Contract & Implementation Directives (written for Option P1; CC rewrites this section if another option is chosen)

1. Ledger `[IN_PROGRESS]`. `build-graph`; map `CreateAnalysisUseCase` → client `useSSEStream` stream dispatch → worker.
2. `web/lib/usecases/PlanAnalysisUseCase.ts` (pure core + ports): input `{ analysisId, transcript, bundles, jevConfig, costCap, priceTable }` → output `{ K, streamCount, cells: {jevChunkIndex, chunkIndex, startWord, endWord, sha256}[], estimateCents, truncatedFallback: boolean }`. `analysis.jev.enabled = false` ⇒ K = 1. Cost cap A6: merge smallest adjacent chunks until the estimate fits; if K = 1 still exceeds the cap ⇒ `truncatedFallback = true` (today's budget path).
3. Registry key `analysis.jev.maxCostUsdCentsPerVideo` (new migration file, not applied; default = the value that yields K = 1 for a 48,000-char transcript at current prices, computed and shown in the report).
4. Route `web/app/api/analyses/[id]/plan/route.ts`: thin; S2S HMAC verify (same as persist); idempotent write of `stream_count` (second call returns the stored plan, never re-chunks).
5. Client (`web/hooks/useSSEStream.ts`): when a plan with K > 1 arrives, dispatch the grounded cells with v2 tokens; K = 1 ⇒ exactly today's 5 streams (regression test).
6. Tests: pure plan (K=1 when disabled; cost-cap merging; fallback); route idempotence; client K=1 path unchanged.
7. Gates, commit, ledger.

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
