# Agent Dispatch Prompt — Comments Dispatch A: async Cochran-sampled, Jev-classified comment runs (backend + schema)

**Target Agent**: OC (`glm-preset/@preset/glm-53-flash-on-cheap`, CLAUDE.md "OC model standard")
**Effort Level**: medium
**Series**: standalone (Jev comment classification). Pilot evidence (CC, 2026-09-30): see §1.

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

1. Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-tier3` (branch `feat/comments-tier3-jev`, created by CC from `origin/main`). Home dir `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files. If the same test fails twice for the same reason, STOP and report `[BLOCKED]`.
3. No live-DB writes, no migration apply, no deploys, no secrets printed. CC applies migrations (ADR 018).
4. qa-intel findings are NOT advisory (CI fails on them). Fix new-code findings; never baseline new code.
5. Commit when done (no push). Paste `git status --short` first: only the files named below.
6. Negative control for EVERY behavioural test you add: revert the fix → the test fails; paste the output. A test that passes without the fix proves nothing.

---

## 1. Context & Problem Statement

User-approved design (2026-09-30). **Hard dependency: PR #376 (JevCommentClassifier) must be merged to `origin/main` first — CC rebases this worktree onto it before you start; if `worker/src/services/JevCommentClassifier.ts` is absent, STOP and report `[BLOCKED]`.**

Today (verified by CC):
- `worker/src/queue-consumers/comments-tier3.ts` is an "uncapped" consumer: it pages up to `MAX_PAGES = 400` (40k comments), then **discards** them and reports only a count to `web/app/api/comments/persist-sample-run/route.ts` (signed S2S, Zod `PersistRequestSchema`). Nothing is sampled, classified or stored.
- Message type `CommentsTier3QueueMessage` lives in `worker/src/routes/comments.ts`; system (no-charge) runs are enqueued by `web/lib/services/aux-remediation.ts` `enqueueSystemCommentsBackfill` (~L247) via `SupabaseAuxRemediationAdapter.insertSystemCommentSampleRun`.
- Sampling math exists and is pure: `web/lib/services/comment-sampling.ts` (`cochranSampleSize` with finite-population correction, `resolveTierSampleCount`, `stratifiedSampleIndices` = like-count × recency buckets). Registry keys `comments.cochran.*`, `comments.sampling.*` (incl. `syncPoolMaxPages` 10, `likeBucketCount` 3, `recencyBucketCount` 3).
- Paging: `worker/src/services/MetadataScraper.ts` `fetchCommentsPage` (~L286) hardcodes `order=relevance`.
- Storage: `comment_sample_runs` (tier, total_comment_count, cochran_n, sampled_count, status pending|sampling|completed|failed) and `comment_classifications` (only `label text`, `model_used`, `cost_usd`, `comment_external_id`, `batch_id`) — migration `20260724130000_comments_sampling_engine.sql`.
- Classifier: `JevCommentClassifier.classifyBatchWithCost(comments) → { results, costUsd, failedCount }` (settings `comments.jev.*`).

**Contract (the user's rule: comments are an async enrichment layer, the analysis NEVER waits):**
input = a queued run `{ sampleRunId, videoId, userId, totalCommentCount, mode: 'cochran' }` → output =
(1) `comment_classifications` rows with typed columns for every successfully classified sampled comment;
(2) `analysis_payload.commentInsights = { population: <pool size actually fetched>, reportedTotal: <totalCommentCount>, sampleSize, classified, failed, lowConfidence, marginOfError, confidence: 0.95, sentiment: {positive,negative,neutral,mixed}, types: {...}, painPointCount (noul>=0.8), questionCount (noul>=0.8), costUsd, model, completedAt }` — `marginOfError` computed from the ACTUAL classified count and pool size (finite-population corrected), never the target;
(3) `analysis_payload.comments` = the sampled comments ONLY if the row has none (never overwrite);
(4) `comment_sample_runs.status` pending → sampling → completed|failed, `sampled_count`, `cochran_n`.

## 2. Contract & Implementation Directives

1. Ledger `[IN_PROGRESS]`. `build-graph`; map queue producer → consumer → persist route → adapter.
2. **Migration** (new file `supabase/migrations/20260930170000_comment_classifications_typed.sql`, NOT applied): add nullable typed columns to `comment_classifications`: `sentiment text check (in 4 values)`, `comment_type text check (7 values incl. experience)`, `pain_point real check 0..1`, `question_asked real check 0..1`, `intensity real check 0..2`, `sentiment_confidence real check 0..1`, `low_confidence boolean`, `comment_text text`, `like_count integer`, `published_at timestamptz`; keep `label` (legacy, unused); unique `(comment_sample_run_id, comment_external_id)` for idempotent retries. RLS unchanged. Add `mode text` (`'uncapped'|'cochran'`, default `'uncapped'`) to `comment_sample_runs`. Registry key `comments.sampling.recencyPoolMaxPages` (default 10, 1..50).
3. **Paging:** `fetchCommentsPage` takes an `order: 'relevance' | 'time'` param (default `relevance`, so existing callers are unchanged).
4. **Consumer, `mode: 'cochran'`** (uncapped path unchanged): mark `sampling`; fetch a relevance pool (≤ `syncPoolMaxPages` pages) and a time pool (≤ `recencyPoolMaxPages` pages); de-duplicate by comment id; `n = cochranSampleSize(pool.length, cochran params)`; pick `n` via `stratifiedSampleIndices`; classify with `JevCommentClassifier` (registry-resolved config passed in the message or resolved server-side — no hardcoded fallback in the consumer); send results to persist. Registry values must travel in the signed message or be resolved on Vercel; the consumer must not invent defaults silently (log + Sentry if a value is missing).
5. **Persist route:** extend the Zod schema (`mode`, `classifications[]` with the typed fields, `insights`); upsert classifications idempotently; write `commentInsights` and (only if absent) `comments` into `analysis_payload` through the existing adapter (never raw SQL in the route; route stays thin; add a port method if needed); update the run row. Signature verification unchanged.
6. **Producer:** `enqueueSystemCommentsBackfill` sends `mode: 'cochran'`; add `mode` to `CommentsTier3QueueMessage` (optional, default uncapped for backwards compatibility with in-flight messages).
7. **Tests** (web: `web/lib/__tests__/`; worker: `worker/src/__tests__/`): pure pool→sample→insights builder (dedupe, n ≤ pool, margin of error from actual counts, painPoint/question thresholds); consumer with stubbed YouTube + stubbed Jev: 2 orders requested, status transitions, failed classifications counted not stored; persist route: Zod accepts the new body, never overwrites existing `comments`, idempotent re-post. Negative control for "never overwrite comments" and "margin from actual counts".
8. Gates, qa-intel after `git add`, commit `feat(comments): async Cochran-sampled Jev comment runs (Tier 3 cochran mode)`, ledger `[DONE]`.

Out of scope: UI (Dispatch B), running the backfill, deleting the uncapped path.

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
