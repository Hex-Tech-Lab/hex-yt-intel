# Agent Dispatch Prompt — R3b 2.4: pure deterministic reduce of grounded cells (Addendum A5)

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

1. Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-r3b-24` (branch `feat/r3b-2-4-reduce`, created by CC from `origin/main`). Home dir `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files. If the same test fails twice for the same reason, STOP and report `[BLOCKED]`.
3. No live-DB writes, no migration apply, no deploys, no secrets printed. CC applies migrations (ADR 018).
4. qa-intel findings are NOT advisory (CI fails on them). Fix new-code findings; never baseline new code.
5. Commit when done (no push). Paste `git status --short` first: only the files named below.
6. Negative control for EVERY behavioural test you add: revert the fix → the test fails; paste the output. A test that passes without the fix proves nothing.

---

## 1. Context & Problem Statement

Addendum A5 defines how K per-chunk grounded outputs merge into one grounded result before Bundle B. This is a PURE module (no I/O); it is independent of 2.1–2.3 and can be built against the current dimension payload shapes (see `web/lib/services/stitch-analysis-chunks.ts` for how bundle payloads are stitched today and which dimension fields exist; `web/lib/config/prior-payload.ts` for the projective envelope cap `fitPriorPayloadToCap`).

## 2. Contract & Implementation Directives

1. Ledger `[IN_PROGRESS]`. `build-graph`; list the dimension payload fields per dimension (arrays vs prose vs numeric) from the real Zod schemas — paste the table in the report.
2. `web/lib/services/reduce-grounded-chunks.ts`: `reduceGroundedChunks(cells: { jevChunkIndex: number; wordCount: number; dimensions: Dimension[] }[]) → { dimensions: Dimension[]; partial: number[] /* dimension numbers missing from some chunks */ }`. Rules (exactly A5):
   - order by `jevChunkIndex` ascending, never by input order;
   - arrays: concatenate in order, dedupe by normalised key (lowercase, collapse whitespace; `label`/`text`; timestamped items by `(label, timestamp)`), keep first;
   - prose `content`: join per-chunk sections in order with one blank line; no rewriting;
   - numeric scores: `wordCount`-weighted mean over chunks that have the dimension, rounded like the source;
   - dimension missing in some chunks → still produced, listed in `partial`; missing in all → absent;
   - output must be byte-identical for the same cell SET regardless of input order.
3. Tests in `web/lib/__tests__/reduce-grounded-chunks.test.ts`: one exact-value test per rule; property tests with a seeded PRNG (write mulberry32 inline; NO single-letter variable names — qa-intel flags them): (a) shuffling input cells never changes `JSON.stringify(output)`; (b) reducing twice == once (idempotent on the same set); (c) K = 1 ⇒ output equals the single cell's dimensions exactly; (d) dedupe never drops an item whose normalised key is unique.
4. Negative controls: (i) sort by input order instead of `jevChunkIndex` → (a) fails; (ii) unweighted mean → the weighted-mean exact test fails.
5. Gates, commit `feat(reduce): deterministic map-reduce of Jev grounded cells (ADR 037 A5)`, ledger.

Out of scope: wiring the reduce into persist/finalize (2.5).

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
