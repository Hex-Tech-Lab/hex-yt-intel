# OC Dispatch — remediation webhook has no cron trigger + unmerged related branch

> **PREMISE CORRECTION (OC, 2026-09-11, post-investigation):** the original
> root-cause claim below ("no `crons` array in vercel.json — nothing ever
> calls it") was WRONG. Verified reality: scheduling was never the gap —
> `vercel.json` is irrelevant because the webhook is QStash-signature
> verified (not Vercel CRON_SECRET), and `web/scripts/setup-qstash-cron.ts`
> already registers `dimension-remediation` (*/5 * * * *), the CI
> `cron-registration` job is green, and the live QStash API confirmed the
> schedule firing with SUCCESS states. The REAL root cause (Task 1 result):
> the $2.00 monthly token-bucket hardCap was drained to 0 by a 35-minute
> retry storm on 2026-09-01 (12 transcript-purged/unfetchable rows, 88
> usage_log events) — WorkerFailed never incremented the retry counter, so
> rows retried unboundedly; every tick since has silently no-op'd
> (BudgetExhausted, 200 OK to QStash). Fix implemented 2026-09-11 on
> `fix/remediation-cron-not-wired`: transcript-presence candidacy gate +
> failed-attempt retry burn (port/adapter/service + tests). See ledger
> [DONE] entry for full evidence and the Task 2 outcome.

Built from `docs/agent-prompts/TEMPLATE.md`. Model: OC (opencode, GLM 5.3 Flash, low effort) via relace.

## Ledger protocol (ALWAYS INCLUDE)
1. Read `.memory/AGENT_LEDGER.md` before touching any file.
2. Append `[IN_PROGRESS] OC <timestamp> — dispatch-oc-remediation-cron-not-wired: <intent>, target files`.
3. Flip to `[DONE]` with a one-line summary when finished. Do not merge/close the workflow yourself — CC is the sink orchestrator for this task.

## Step 0 (ALWAYS INCLUDE)
Use `code-review-graph` MCP tools (`semantic_search_nodes_tool`, `query_graph_tool`) before Grep/Read to explore `web/app/api/webhooks/remediate-dimensions/route.ts`, `web/lib/services/dimension-remediation.ts`, and `vercel.json`.

## Context (FILL IN)
Two videos in Analysis History are stuck (user-reported, 2026-09-11):
- `NE-62S4OYCg` ("Lazy AI Side Hustle...") — genuinely 0/11 dims, `validation_report.status='failed'`, already retried once and failed again identically both times. OUT OF SCOPE for this task — this is a real extraction bug on a specific ~90-min livestream video, not a remediation-pipeline gap. Do not touch this one; a separate investigation task will cover it later.
- `XMA9iZEUL0s` ("Monetise Course Review...") — 10/11 dims, `validation_report.status='partial'`, `billing_status='failed'`, dimension 5 timed out. This EXACTLY matches `dimension-remediation.ts`'s candidate query (line ~318-320: `.eq('billing_status','failed').eq('validation_report->>status','partial')`) but has sat unremediated for 3 days (created 2026-09-08).

Root cause confirmed via direct Supabase query + `grep` of `vercel.json`: **there is no `crons` array in `vercel.json` at all** — the `remediate-dimensions` webhook (`web/app/api/webhooks/remediate-dimensions/route.ts`) exists and is correctly implemented per ADR 019 (dollar-denominated token-bucket budget), but nothing ever calls it automatically. It is dead code from a scheduling standpoint.

There is also an unmerged remote branch `origin/fix/reaper-strict-billing-and-partial-remediation` (confirmed via `git log origin/fix/reaper-strict-billing-and-partial-remediation --oneline` and `git merge-base --is-ancestor` returning NOT MERGED) whose name strongly suggests it already addresses related billing/partial-remediation gaps — check whether it already fixes this exact issue before writing new code.

## Task (FILL IN)
1. `git fetch origin` and inspect `origin/fix/reaper-strict-billing-and-partial-remediation` — diff it against current `main`. If it already adds a cron trigger for `remediate-dimensions` (or fixes this exact gap), evaluate whether it's safe/current to merge (rebase onto latest main, re-run qa-intel + tests) instead of writing new code.
2. If that branch does NOT cover it (or is too stale to trust), add a `crons` entry to `vercel.json` for `POST /api/webhooks/remediate-dimensions` on a reasonable cadence (check `ADR_019_REMEDIATION_BUDGET_TOKEN_BUCKET_2026-07-31.md` in `docs/private/` for the intended budget period — pick a cadence consistent with `remediation.periodDays` in the Settings Registry, not an arbitrary number — this repo's `no-hardcoded-tunables` rule applies).
3. Verify the webhook route itself authenticates cron-only requests correctly (check for a `CRON_SECRET`/Vercel cron auth pattern already used by other cron routes in `web/app/api/cron/` — reuse the existing pattern, don't invent a new one).
4. Once deployed logic is correct, manually trigger the webhook once (or wait for the cron) and confirm via Supabase that `XMA9iZEUL0s`'s row actually gets remediated (dimension 5 backfilled, `billing_status` flips off `'failed'`).

## Goal / Expected results (FILL IN)
- `vercel.json` has a working cron entry for the remediation webhook (or the pre-existing branch is merged and verified).
- `XMA9iZEUL0s` observably remediated in Supabase (dimension_count effectively 11/11, billing_status no longer 'failed').
- No other `billing_status='failed' AND validation_report->>status='partial'` rows regress — spot check with:
  ```sql
  select count(*) from analyses where billing_status='failed' and validation_report->>'status'='partial';
  ```
  before and after.

## Gates (ALWAYS INCLUDE)
qa-intel (`pnpm qa-intel:ci`), vitest for touched files, `tsc --noEmit`, negative-control verification (prove the cron was actually missing before your fix, e.g. by confirming `vercel.json` diff), full skill stack per `feedback_mandatory_skill_stack_every_pr` (fresh `ls ~/.claude/skills .claude/skills` enumeration, not a recalled list).

## Report format (ALWAYS INCLUDE)
Structured: what was found, what was changed, proof (SQL before/after, test output), any items explicitly deferred and why. Post to ledger, then hand back to CC for merge sign-off — do not merge yourself.

---

## SEPARATE TASK — Task 2: root-cause `NE-62S4OYCg` 0/11-dimension double-failure (INVESTIGATE ONLY, do not fix without confirming root cause first)

User pushed back hard on labeling this "just failed" — correctly: OpenRouter fronts a multi-provider, multi-model cascade, so a total cascade failure should be rare (order-of-once-a-year), not something to shrug at. Investigate for real; do not report "failed" as an acceptable answer.

### Evidence already gathered by CC (do not re-derive, build on this):
- Analysis rows `6d9b61f2-9599-4c49-9bfb-1b4bebf8a37e` (2nd attempt, 2026-09-10 08:28) and `32aeeb78-2318-4272-896a-f7885dd38622` (1st attempt, 2026-09-08 16:55, now archived) — both for video `NE-62S4OYCg`, both `validation_report.status='failed'`, `reaped_dimensions: 0`, `reaped: true`. **Failed identically on both attempts, 2 days apart** — this rules out the user's initial hypothesis of "YouTube auto-caption not generated yet for a fresh livestream" (a delay-based cause should have resolved by the 2nd attempt 2+ days later; it did not).
- `transcripts` table confirms a real transcript WAS fetched and cached: `length(content) = 89208` chars (~22-25K tokens) for `video_id='NE-62S4OYCg'`, created `2026-09-08 16:55:41`. This is a normal size, not something that should blow any model's context window in the cascade.
- Sentry (`hex-org` org, region `https://de.sentry.io`) has **zero** events (checked both `errors` and `logs` datasets, 7d window) mentioning `NE-62S4OYCg`. No exception was ever captured for either attempt.
- Video metadata: `duration: 5373s` (~90 min), a livestream (`"During our live stream, we are attempting to break the Guinness World Records..."`), published `2026-09-07T20:45:27Z`.
- `analysis-reaper.ts`'s own Sentry captures (`captureException` calls at lines 350/370/380/419/445 in `web/lib/services/analysis-reaper.ts`) are about the *reap/requeue* mechanics, not about why the original stream produced zero dimensions — so the reaper reporting nothing here is expected, but it also means whatever silently killed dimension production upstream of the reaper never threw a captured exception either.

### What this evidence rules IN vs OUT
- RULED OUT: caption/transcript-not-ready-yet (transcript existed both times, 2+ days apart).
- RULED OUT: oversized-transcript/context-window issue (89K chars is unremarkable).
- STILL OPEN: (a) OpenRouter budget/credit exhaustion at the exact time of both attempts (check OpenRouter dashboard/API usage logs for 2026-09-08 ~16:55-17:30 UTC and 2026-09-10 ~08:28-09:00 UTC — do NOT guess, pull real usage/error data); (b) a bug specific to this analysis's request path that never reaches the model cascade at all (e.g. an early-exit guard, a malformed prompt construction for unusually long-duration videos, a worker-side crash before any `fetch()` to OpenRouter) — check `worker/src/routes/analysis.ts`'s streaming entrypoint for any guard/early-return keyed on `duration` or transcript length that could silently no-op; (c) Cloudflare Worker logs for these two specific time windows (use `cloudflare-observability` MCP tools — CC's attempt hit a tool-side schema bug filtering on `$metadata.message`, try `$metadata.error` exists or `$metadata.trigger` instead, or use `observability_keys`/`observability_values` first to find a working filter).

### Task
1. Pull real Cloudflare Worker logs for both time windows (`2026-09-08T16:50:00Z`–`2026-09-08T17:35:00Z` and `2026-09-10T08:20:00Z`–`2026-09-10T09:05:00Z`) filtered to this video/request if possible. Identify the actual failure point: did the worker ever call OpenRouter for this analysis? Did OpenRouter return an error (rate limit, budget, model unavailable) or did the request simply never fire?
2. Check whether OpenRouter account budget/credits were exhausted at either timestamp (check for any local budget-tracking table/log — `remediation.*` Settings Registry keys track a *different* budget (dimension remediation), the main analysis cascade may have its own separate budget/rate tracking — find it and check history for those two windows).
3. Check `worker/src/routes/analysis.ts` for any code path keyed on video duration, transcript length, or livestream-specific metadata that could cause a silent early exit with zero LLM calls made — this is the most likely code-level culprit given zero Sentry activity and a real cached transcript.
4. Report the ACTUAL confirmed root cause with evidence (log lines, timestamps, specific code path) — not a guess, not "failed intermittently." If genuinely inconclusive after real investigation, say so explicitly and list what was ruled out and what remains unknown, rather than defaulting back to "it just failed."
5. Do NOT attempt a fix in this pass unless the root cause is trivially safe to correct (e.g. a one-line guard bug) — if it needs design discussion (e.g. adding duration-aware handling, cascade retry logic changes), stop and report findings for CC/user decision instead.
