# OC Dispatch — ~~remediation webhook has no cron trigger~~ + unmerged related branch

> ## ⚠️ OBSOLETE PREMISE — DO NOT ACT ON THE STRUCK-THROUGH INSTRUCTIONS BELOW
>
> **STATUS: RESOLVED AND SUPERSEDED (2026-09-11).** The original premise of
> this dispatch — "no `crons` array in `vercel.json`, nothing ever calls the
> webhook, it is dead code from a scheduling standpoint" — was **WRONG**, and
> the fixes it prescribed (adding a Vercel cron, a `CRON_SECRET` pattern,
> manually triggering remediation for `XMA9iZEUL0s`) were **never needed and
> must not be implemented**. Every obsolete instruction below is struck
> through inline. This notice is repeated at each affected section so an
> agent skimming any single section still cannot act on stale instructions.
>
> **Verified reality (2026-09-11, live checks):**
> - Scheduling was never the gap: the webhook is QStash-signature verified
>   (a Vercel cron would 401), `web/scripts/setup-qstash-cron.ts` has
>   registered `dimension-remediation` (*/5 * * * *) since PR #165
>   (2026-07-31), the CI `cron-registration` job is green, and the live
>   QStash API showed the schedule firing with SUCCESS states.
> - REAL root cause: the $2.00 monthly token-bucket hardCap was drained to 0
>   by a 35-minute retry storm on 2026-09-01 (12 transcript-purged/unfetchable
>   rows, 88 usage_log events) — WorkerFailed never incremented the retry
>   counter, so rows retried unboundedly; every tick since silently no-op'd
>   (BudgetExhausted, 200 OK to QStash).
> - FIX (landed 2026-09-11, commit 67b2d6c7 on `fix/remediation-cron-not-wired`,
>   later merged via PR #310): transcript-presence candidacy gate +
>   failed-attempt retry burn (port/adapter/service + tests). `vercel.json`
>   needed NO change.
> - `XMA9iZEUL0s`: NEVER auto-remediable — its transcript is now ALSO purged
>   (verified `[]` via REST). A manual re-analyze is the only recovery path
>   (user directive: report, do not auto-fix).
> - Full evidence: `.memory/AGENT_LEDGER.md` [DONE] entry,
>   2026-09-11T21:15:00+03:00.

Built from `docs/agent-prompts/TEMPLATE.md`. Model: OC (opencode, GLM 5.3 Flash, low effort) via relace.

## Ledger protocol (ALWAYS INCLUDE)
1. Read `.memory/AGENT_LEDGER.md` before touching any file.
2. Append `[IN_PROGRESS] OC <timestamp> — dispatch-oc-remediation-cron-not-wired: <intent>, target files`.
3. Flip to `[DONE]` with a one-line summary when finished. Do not merge/close the workflow yourself — CC is the sink orchestrator for this task.

## Step 0 (ALWAYS INCLUDE)
~~Use `code-review-graph` MCP tools (`semantic_search_nodes_tool`, `query_graph_tool`) before Grep/Read to explore `web/app/api/webhooks/remediate-dimensions/route.ts`, `web/lib/services/dimension-remediation.ts`, and `vercel.json`.~~

> ⚠️ OBSOLETE (2026-09-11): this dispatch is fully resolved — see the
> notice at the top. No code changes are pending from this file. Retained
> only as a historical record so the premise correction travels with the
> instructions it corrects.

## Context (FILL IN) — ~~partially obsolete, see inline markers~~
Two videos in Analysis History are stuck (user-reported, 2026-09-11):
- `NE-62S4OYCg` ("Lazy AI Side Hustle...") — genuinely 0/11 dims, `validation_report.status='failed'`, already retried once and failed again identically both times. OUT OF SCOPE for this task — this is a real extraction bug on a specific ~90-min livestream video, not a remediation-pipeline gap. Do not touch this one; a separate investigation task will cover it later.
- `XMA9iZEUL0s` ("Monetise Course Review...") — 10/11 dims, `validation_report.status='partial'`, `billing_status='failed'`, dimension 5 timed out. This EXACTLY matches `dimension-remediation.ts`'s candidate query (line ~318-320: `.eq('billing_status','failed').eq('validation_report->>status','partial')`) but has sat unremediated for 3 days (created 2026-09-08).

~~Root cause confirmed via direct Supabase query + `grep` of `vercel.json`: **there is no `crons` array in `vercel.json` at all** — the `remediate-dimensions` webhook (`web/app/api/webhooks/remediate-dimensions/route.ts`) exists and is correctly implemented per ADR 019 (dollar-denominated token-bucket budget), but nothing ever calls it automatically. It is dead code from a scheduling standpoint.~~

> ⚠️ OBSOLETE: WRONG root cause. Scheduling was always live (QStash */5,
> registered since PR #165; CI cron-registration green). The real root cause
> is the 2026-09-01 budget drain + unbounded retry storm described in the
> top notice — fixed by PR #310 and its follow-ups. Do not re-add any cron
> trigger.

~~There is also an unmerged remote branch `origin/fix/reaper-strict-billing-and-partial-remediation` (confirmed via `git log origin/fix/reaper-strict-billing-and-partial-remediation --oneline` and `git merge-base --is-ancestor` returning NOT MERGED) whose name strongly suggests it already addresses related billing/partial-remediation gaps — check whether it already fixes this exact issue before writing new code.~~

> ⚠️ RESOLVED (2026-09-11): the branch was evaluated — its code content is
> ALREADY on main (shipped via #306 squash 5f1e953c; two-dot file compare
> shows analysis-reaper.ts/persist route identical) and it is 1756 lines
> BEHIND main, so merging would revert newer work. Recommended: delete.
> CC's call.

## Task (FILL IN) — ~~ENTIRELY OBSOLETE, superseded by the fix above~~
~~1. `git fetch origin` and inspect `origin/fix/reaper-strict-billing-and-partial-remediation` — diff it against current `main`. If it already adds a cron trigger for `remediate-dimensions` (or fixes this exact gap), evaluate whether it's safe/current to merge (rebase onto latest main, re-run qa-intel + tests) instead of writing new code.~~

> ⚠️ OBSOLETE: evaluated 2026-09-11 — content already on main, branch is
> stale (1756 lines behind). Do not merge. Recommended: delete (CC's call).

~~2. If that branch does NOT cover it (or is too stale to trust), add a `crons` entry to `vercel.json` for `POST /api/webhooks/remediate-dimensions` on a reasonable cadence (check `ADR_019_REMEDIATION_BUDGET_TOKEN_BUCKET_2026-07-31.md` in `docs/private/` for the intended budget period — pick a cadence consistent with `remediation.periodDays` in the Settings Registry, not an arbitrary number — this repo's `no-hardcoded-tunables` rule applies).~~

> ⚠️ OBSOLETE and actively HARMFUL if implemented: the webhook is
> QStash-signature verified — a Vercel cron would fail signature
> verification (401) on every tick. No cron entry was added; none is needed.

~~3. Verify the webhook route itself authenticates cron-only requests correctly (check for a `CRON_SECRET`/Vercel cron auth pattern already used by other cron routes in `web/app/api/cron/` — reuse the existing pattern, don't invent a new one).~~

> ⚠️ OBSOLETE: the route authenticates via QStash signature verification
> (`verifyQStashSignature`), which is the correct mechanism for a QStash-
> delivered webhook. No `CRON_SECRET` pattern applies.

~~4. Once deployed logic is correct, manually trigger the webhook once (or wait for the cron) and confirm via Supabase that `XMA9iZEUL0s`'s row actually gets remediated (dimension 5 backfilled, `billing_status` flips off `'failed'`).~~

> ⚠️ OBSOLETE and impossible: `XMA9iZEUL0s`'s transcript is now ALSO purged
> (verified `[]` via Supabase REST), so it can never auto-remediate. The
> scheduled cron DID fire and correctly did nothing (BudgetExhausted → 200
> OK). A manual re-analyze is the only recovery path (user directive:
> report, do not auto-fix).

## Goal / Expected results (FILL IN) — ~~superseded~~
~~- `vercel.json` has a working cron entry for the remediation webhook (or the pre-existing branch is merged and verified).~~
~~- `XMA9iZEUL0s` observably remediated in Supabase (dimension_count effectively 11/11, billing_status no longer 'failed').~~
~~- No other `billing_status='failed' AND validation_report->>status='partial'` rows regress — spot check with:~~
  ```sql
  select count(*) from analyses where billing_status='failed' and validation_report->>'status'='partial';
  ```
  before and after.

> ⚠️ OBSOLETE: the actual outcome (2026-09-11) was: transcript-presence
> candidacy gate + failed-attempt retry burn shipped (PR #310), bucket
> stays empty until the 2026-10-01 calendar reset by design (ADR 019
> no-refill rule), and the partial-population SQL above remains valid as a
> monitoring query only.

## Gates (ALWAYS INCLUDE)
~~qa-intel (`pnpm qa-intel:ci`), vitest for touched files, `tsc --noEmit`, negative-control verification (prove the cron was actually missing before your fix, e.g. by confirming `vercel.json` diff), full skill stack per `feedback_mandatory_skill_stack_every_pr` (fresh `ls ~/.claude/skills .claude/skills` enumeration, not a recalled list).~~

> ⚠️ OBSOLETE: the "prove the cron was missing" negative control is moot —
> the cron was never missing. The real negative controls used for the actual
> fix (retry-burn before/after, transcript-gate starvation before/after) are
> in the PR #310 test suite and this repo's follow-up dispatch
> (`2026-09-11-oc-pr310-review-findings.md`).

## Report format (ALWAYS INCLUDE)
~~Structured: what was found, what was changed, proof (SQL before/after, test output), any items explicitly deferred and why. Post to ledger, then hand back to CC for merge sign-off — do not merge yourself.~~

> ⚠️ Reported in `.memory/AGENT_LEDGER.md` [DONE] 2026-09-11T21:15:00+03:00.

---

## SEPARATE TASK — Task 2: root-cause `NE-62S4OYCg` 0/11-dimension double-failure ~~(INVESTIGATE ONLY, do not fix without confirming root cause first)~~

> **STATUS: COMPLETED (2026-09-11), INVESTIGATE-ONLY honored.** Reported
> as-is per user directive; see `.memory/AGENT_LEDGER.md`
> 2026-09-11T21:15:00+03:00 for the full findings. Summary: attempt 2
> (6d9b61f2, 2026-09-10 08:28:33) shows exactly 2 Sentry events at 08:28:39
> ("channel-meta dropped: fetch exceeded time budget" — worker WAS alive in
> its fetch phase), then total silence: zero cascade errors, zero
> abort/timeout captures, zero analysis_chunks rows, zero usage_logs; the
> reaper killed it at 09:00:04. Attempt 1 (32aeeb78) completed 2/5 chunks
> (4/11 dims), then 40h silent — same zero-capture signature. Ruled out:
> budget/credit exhaustion (live key check: $98.11 remaining of $110),
> transcript-missing (89K-char transcript existed both times),
> oversized-context. Blocked-path: full confirmation needs Cloudflare Worker
> execution logs for 2026-09-08 16:50–17:40Z and 2026-09-10 08:20–09:10Z —
> cloudflare-observability MCP is server-side broken ('$workers.outcome
> expected string, received undefined', CC-confirmed), no local CF/Vercel
> creds (GH secrets only), GitHub cannot dispatch a workflow that exists
> only on a non-default branch. **CC/user should pull those two windows
> directly from the CF dashboard.** Best-supported hypothesis (NOT
> confirmed): intermittent bundle/stream failure + the then-live
> abort-on-partial-failure behavior — both since addressed on main by #305
> (bundle retry, merged 09-11) and #306 (salvage-threshold fix).

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
- RULED OUT (2026-09-11 OC pass): OpenRouter budget/credit exhaustion at either timestamp — live key check showed $98.11 remaining of $110, and monthly usage ~$11.89 makes 09-08/09-10 exhaustion arithmetically implausible.
- STILL OPEN: (a) Cloudflare Worker execution logs for the two specific time windows (blocked — see status notice above); (b) a bug specific to this analysis's request path that never reaches the model cascade at all (e.g. an early-exit guard, a malformed prompt construction for unusually long-duration videos, a worker-side crash before any `fetch()` to OpenRouter) — check `worker/src/routes/analysis.ts`'s streaming entrypoint for any guard/early-return keyed on `duration` or transcript length that could silently no-op.
