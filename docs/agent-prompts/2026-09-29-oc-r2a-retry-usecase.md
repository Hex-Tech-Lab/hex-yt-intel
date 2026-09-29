# Agent Dispatch Prompt — R2a: RetryMissingDimensionsUseCase (audit finding 1)

**Target Agent**: OC (opencode) — model `glm-preset/@preset/glm-53-flash-on-cheap` (CLAUDE.md "OC model standard" v4)
**Effort Level**: medium

**Hard rules — MANDATORY (lessons 2026-09-29):**
- The ONLY valid home path is `/home/kellyb_dev` (UNDERSCORE). `/home/kellyb-dev` or any other path is rejected and KILLS your run.
- Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-r2` (step 1 creates it). Never touch the main checkout except appending to its `.memory/AGENT_LEDGER.md`. Never read `~/.claude` or another agent's files.
- NEVER run `git stash`, `git reset`, `git checkout -- <file>` or `git clean`. To compare with the base, use `git diff` or `git show HEAD:<file>`.
- NEVER delete or weaken an existing test. You may UPDATE an assertion only where this contract deliberately changes behaviour, and you must name each one in the report.
- NO gate-gaming: no empty `finally` blocks, no rewrites just to dodge a rule, no drive-by renames/import moves/extra logging, and NEVER edit `scripts/quality-engine/**` or `.qa-intel/baseline.json`. PRE-EXISTING qa-intel finding in a touched file: list it and STOP; CC decides. Findings in code you wrote: fix them properly. Run qa-intel AFTER `git add` (the scanner only sees tracked files).
- Do NOT run `supabase db push`, `supabase link`, or anything that sources `.env*` files. Write migration FILES only; CI applies them.
- Touch ONLY the files the steps name (plus their tests). Paste `git status --short` and `git diff --stat` before committing.
- Gates (paste real output, all exit 0): web tsc; worker tsc (`-p tsconfig.typecheck.json`); web vitest (full); web lint; `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare`; `pnpm --filter youtube-intelligence-worker run build`.

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

## 1. Context & Problem Statement

History's "Retry Missing (N)" button (`web/components/templates/console/AnalysisHistory.tsx`) is disabled by the R0 stopgap (#361). Root cause (CC-verified):
- The button POSTs `{url, analysisId, missingDimensions}` to `/api/analyses`.
- On main, `AnalysisCreateSchema` (`web/lib/types/contracts.ts` ~line 73) declares neither field, so Zod drops them.
- `CreateAnalysisUseCase.execute` then runs `findCachedAnalysis`, which deliberately accepts partial rows with content, so it returns `cache_hit` and NOTHING is retried.
- Even with `forceRefresh`, it would reserve quota and insert a NEW row.

A per-analysis, budget-gated, server-side re-generation path ALREADY EXISTS: `remediateAnalysis(gap, models, cascade, budget)` in `web/lib/services/dimension-remediation.ts` (~line 763), used by the 5-minute cron `runRemediationHarness`. Its `AnalysisGap` type is at ~line 258; `resolveBudgetParams`, `computeMissingDimensions`, `findAnalysesWithMissingDimensions` and the token-bucket logic are in the same file. REUSE it; do not build a second retry pipeline.

## 2. Contract & Implementation Directives

**Contract — `POST /api/analyses/[id]/retry`** (new route, ultra-thin; logic in `web/lib/usecases/RetryMissingDimensionsUseCase.ts`):
- Auth: Supabase session required (401 otherwise). Ownership: the row must belong to the caller (404 if not, NOT 403, so we don't leak existence).
- Body (Zod): `{ missingDimensions?: number[] }` (ints 1..11, unique, max 11). Optional: if omitted, the server computes the missing set itself.
- Server-authoritative missing set: compute the ACTUAL missing dimensions from the row (reuse `computeMissingDimensions` / the same logic the cron uses). Requested dims NOT actually missing → drop them silently. Nothing actually missing → 200 `{status:'nothing_missing'}`.
- Eligibility: only rows the cron itself would remediate (partial/failed-with-content). `processing` → 409 `{error:'in_progress'}`. Cancelled → 409.
- Idempotency: a Redis lock (reuse the project's existing Redis helper; grep `web/lib/redis.ts`) keyed `retry:analysis:<id>`, TTL 10 min. A concurrent retry → 409 `{error:'retry_in_progress'}`.
- NO cache, NO quota reservation, NO new row: reuse the row id.
- Execution: build the `AnalysisGap` for this row and call `remediateAnalysis` with the SAME models/cascade/budget resolution the cron uses (extract a small shared helper if the cron inlines it; do not duplicate). `BudgetExhausted` → 429 `{error:'budget_exhausted'}`. Success → 200 `{status, stage, dimensionsRequested, dimensionCountAfter}`.
- Hexagonal: the route validates, authenticates and dispatches; the use case holds the rules; persistence goes through the existing ports/adapters.

Steps, IN ORDER:
1. `git -C /home/kellyb_dev/projects/hex-yt-intel fetch origin && git -C /home/kellyb_dev/projects/hex-yt-intel worktree add /home/kellyb_dev/projects/hex-yt-intel-r2 -b fix/r2-retry-and-context origin/main && cd /home/kellyb_dev/projects/hex-yt-intel-r2 && pnpm install --frozen-lockfile`
2. Read `dimension-remediation.ts` in full (the file, not a summary) and `runRemediationHarness` to see how models/cascade/budget are resolved. Write down, in your report, the exact functions you will reuse.
3. Use case + route (contract above).
4. Tests `web/lib/usecases/__tests__/RetryMissingDimensionsUseCase.test.ts`: 401 no session; 404 foreign row; 409 processing; 409 concurrent (lock held); nothing_missing; requested ⊄ actual → only actual dims sent to `remediateAnalysis` (spy); budget exhausted → 429; success passes the SAME row id (no new row, no quota call — spy on the quota RPC/adapter and assert NOT called).
5. NEGATIVE CONTROL: make the use case skip the ownership check; the 404 test must FAIL; restore.
6. Gates (see hard rules). Commit `feat(retry): R2a RetryMissingDimensionsUseCase (server-side, budget-gated, owner-checked)` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push. STOP and report.
- Leave `AnalysisHistory.tsx` UNCHANGED: the button stays disabled until R4 wires it to this endpoint.

## 3. Pre-PR Review Skills
- STEP 0: `build-graph`; `query_graph_tool` callers_of `remediateAnalysis`, `runRemediationHarness`.
- ALWAYS: `qa-intel` (both modes), `code-reviewer`, `review-delta`, `review-duplication`.
- API/security: `owasp-top-10`, `race-condition-guard` (the lock), `security-review`.

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

Scoped checklist:
1. Contract = the endpoint contract above, enforced by the step 4 tests.
2. E2E: POST → auth → ownership → server-computed missing set → lock → `remediateAnalysis` (same row) → persisted dims → response. Show it with the success-path test.
3. Tangents: can the 5-min cron and a user retry both remediate the same row at the same time? Check whether the cron takes the same lock; if not, REPORT it (do not change the cron).

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
