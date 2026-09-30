# Agent Dispatch Prompt — P1: comments silently missing on every analysis since 2026-09-27

**Target Agent**: OC (`glm-preset/@preset/glm-53-flash-on-cheap`, CLAUDE.md "OC model standard")
**Effort Level**: medium — INVESTIGATION FIRST, fix only after the RCA is proven

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

## HARD RULES

1. Work ONLY in `/home/kellyb_dev/projects/hex-yt-intel-comments` (branch `fix/comments-silent-loss`). Home dir `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files. Probe scripts go in `/tmp/opencode/comments-probe/` only. If the same test fails twice for the same reason, STOP and report `[BLOCKED]`.
3. READ-ONLY on production: no writes to Supabase, no deploys, no `wrangler` commands, no secrets printed. You MAY read public YouTube pages/APIs to reproduce a fetch.
4. Do NOT change code until Step 4 has a proven RCA. qa-intel findings are NOT advisory: CI fails on them.
5. Commit when done (no push). Paste `git status --short` first.

---

## 1. Context & Problem Statement

Live DB (queried by CC 2026-09-30): `analyses.analysis_payload->'comments'` is NULL (not an empty array; the key is absent or null) on **every** analysis created since 2026-09-27 ~12:00 UTC (11 rows, incl. video ids `EOdXR6lU5ZA`, `EOiypb2wXM0`, `yB92mx97A8s`, `39hqY3nH5ug`, `Y8vAQ1FgNbM`, `DlNWYzaL_F0`). The last row WITH comments: `EOiypb2wXM0_archived_1790584828.427545`, created 2026-09-27 16:11 (11 comments) — so it is intermittent-to-total, not a clean cutover; find what differs. **Sentry shows no comment-related issue in 7 days**: the failure is silent. History overview reads `has_comments` from `jsonb_array_length(analysis_payload->'comments') > 0` (`supabase/migrations/20260928100000_history_overview_function_v16_highlights_duration.sql` ~L117).

Known path (verify, don't trust): the Cloudflare worker fetches comments (`worker/src/routes/analysis.ts`: `commentsConfig` ~L144, `commentsSamplePlan` ~L158, `commentsSyncPoolConfig` ~L165, `normalize…`/`truncateComments` ~L414–460; `worker/src/services/MetadataScraper.ts`; `worker/src/ports/CommentIngestionPort.ts`; `worker/src/queue-consumers/comments-tier3.ts`) and sends them to Vercel persist (`web/app/api/analyses/persist/route.ts`: schema ~L229, `rawComments` ~L307, merge `comments ?? priorPayload?.comments ?? priorReport?.comments ?? null` ~L966 and ~L1281), then `web/lib/adapters/SupabaseAnalysisAdapter.ts` ~L684 (`resolvedComments`). The client forwards `commentsConfig`/`commentsSamplePlan`/`commentsSyncPoolConfig` from the job (`web/hooks/useSSEStream.ts` ~L459).

Merged between 09-26 and 09-29 (suspects, check each): ADR 032 byte-relay worker (Workers Free 10 ms CPU limit, 2026-09-23/24: comment fetching in the worker may exceed CPU or be skipped in `relay` mode), #356 (Wave 1-3 data contracts), #363 R1 (prior_payload guard, grants lockdown), #366, #367, #368 (R2b signed projective context), `cc7759e7` (transcript budget), #348 prompt caching. Settings keys: `chat.comments.*`, `analysis.pipeline.mode`.

---

## 2. Contract & Implementation Directives

**Step 1** — ledger `[IN_PROGRESS]`.
**Step 2 — STEP 0 graph**: `build-graph`, then `query_graph_tool` callers/callees for the comment fetch + persist functions above, to map the full chain before reading files.
**Step 3 — trace, one hop at a time, and write down for EACH hop: input, output, and the exact line where comments can become null/absent**:
  (a) job creation → are `commentsConfig`/`commentsSamplePlan`/`commentsSyncPoolConfig` still built and sent? (`CreateAnalysisUseCase.ts`, settings resolution)
  (b) worker: is the comments fetch still invoked on every analysis? In which pipeline mode? Is it gated, skipped, time-boxed, or swallowed by a `catch` that returns null without Sentry?
  (c) worker → persist: is `comments` in the body the worker/relay sends? (check relay-mode persist too, ADR 032)
  (d) persist Zod schema: can a valid comments array fail validation and be dropped silently (e.g. a field became required, a length cap)?
  (e) persist merge L966/L1281 and the adapter L684: can a later chunk's persist overwrite comments with null? (5 bundle persists per analysis — does the LAST one win?)
  (f) settings: current values of `chat.comments.*` and `analysis.pipeline.mode` (read-only query via the Supabase Management API fallback described in `docs/history/THOS_2026-09-29_2000_96H_AUDIT_R0-R2_REMEDIATION_OC_TAKEOVERS.md` §1.6, never print the token).
  (g) `git log -p --since=2026-09-25` on every file above: list each change that touches comments.
**Step 4 — RCA**: state the root cause with evidence (file:line + the commit that introduced it + why the 09-27 16:11 row still got comments). If you have two candidate causes, prove which one with a failing test, not by reasoning. If you cannot prove it, STOP and report `[PARTIAL]` with the evidence table — do not guess-fix.
**Step 5 — fix** (only after Step 4): minimal, at the root cause. ALSO make the failure loud: wherever comments are dropped because of an error, capture it to Sentry (same pattern the file already uses) — "silent" is part of the bug.
**Step 6 — tests**: a regression test that fails on `origin/main` and passes with the fix (put web tests in `web/lib/__tests__/`; worker tests in `worker/src/__tests__/`). Negative control: revert the fix → test fails; paste output.
**Step 7 — gates** (§4a), qa-intel AFTER `git add`. **Step 8** — commit `fix(comments): <root cause in 8 words>`. **Step 9** — ledger `[DONE]`/`[PARTIAL]`.

Out of scope: backfilling missing comments on existing rows (report how many rows are affected; CC decides), UI changes, the highlights/thumbnail work.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

Use `docs/agent-prompts/TEMPLATE.md` §3 verbatim. Expected matches: STEP 0 `build-graph`; ALWAYS set; BE/API (`worker/**`, `web/app/api/**`, adapters) → `silent-failure-hunter` (this bug IS a silent failure), `type-design-analyzer` if types change. Write "not available in OC" for any skill you cannot invoke.

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

Scoped: (1) contract = "every completed analysis whose video has public comments persists a non-empty `analysis_payload.comments` array, or a Sentry event says why not"; (2) E2E = job creation → worker fetch → persist body → Zod → merge → adapter → DB → `has_comments`; (3) tangents: note other aux fields (channelMeta, description) that may share the same drop path.

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
