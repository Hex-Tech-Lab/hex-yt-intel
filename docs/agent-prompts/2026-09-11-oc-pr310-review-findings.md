# OC Dispatch — fix PR #310 post-merge review findings (real correctness bugs)

Built from `docs/agent-prompts/TEMPLATE.md`. Model: OC (opencode, GLM 5.3 Flash, low effort).

## Ledger protocol (ALWAYS INCLUDE)
1. Read `.memory/AGENT_LEDGER.md` before touching any file.
2. Append `[IN_PROGRESS] OC <timestamp> — dispatch-oc-pr310-review-findings: <intent>, target files`.
3. Flip to `[DONE]` with a one-line summary when finished. Do not merge yourself — CC is the sink orchestrator.

## Environment note (learned the hard way across 5 relaunches on the prior dispatch)
You cannot read or write ANY path outside this worktree directory — not `/tmp`, not `~/.wrangler`, not the main checkout. Any scratch file goes inside this worktree (delete before finishing). If you need external data (Supabase, Sentry, Cloudflare), either use MCP tools if configured in this env, or state clearly in your report that CC needs to pull it — do not spend cycles hunting for credentials in disallowed paths.

## Step 0 (ALWAYS INCLUDE)
Use `code-review-graph` MCP tools before Grep/Read where available.

## Context (FILL IN)
PR #310 (`fix(remediation): bound worker-failure retries + exclude transcript-purged candidates`, merged as `ce61ec7a`) fixed a real production bug (unbounded remediation retries burning the whole monthly budget). It is ALREADY MERGED to main. A post-merge review (Cubic-style) found real follow-up defects in the merged code. This dispatch fixes them on a fresh branch off current main.

## Task — fix these, in priority order

### P1a — `findAnalysesWithMissingDimensions` applies `limit` BEFORE the transcript-existence filter
File: `web/lib/services/dimension-remediation.ts`. The query fetches+limits raw analysis rows, THEN filters by transcript presence in memory. If the first `limit` rows are all transcript-purged (exactly the population this PR was written to exclude), valid candidates further down the result set are never reached — legitimate rows can starve indefinitely.
**Fix**: apply the final `limit` to *eligible* (post-transcript-filter) candidates, not raw rows. Prefer a DB-level transcript-existence filter (join/exists subquery) if the schema supports it cleanly; otherwise paginate through candidate pages (fetch a page, filter, repeat) until you've collected `limit` eligible gaps, with a hard page-count cap so this can't loop forever, batching transcript lookups per page. Preserve fail-closed behavior (transcript query error → throw, don't silently skip).
**Test**: page 1 all transcriptless, page 2 has an eligible candidate — confirm it's still found.

### P1b — Failure-counter persistence is best-effort; write failures are swallowed
Files: `web/lib/services/dimension-remediation.ts`, `web/lib/adapters/SupabasePersistenceAdapter.ts`. `recordRemediationFailure`'s caller catches adapter errors, logs, and still returns `WorkerFailed`/`StitchFailed` — but if the counter write itself fails, the row's retry count never actually increments in the DB, so it can be retried unboundedly. This recreates the exact 2026-09-01 budget-drain class of bug PR #310 was written to prevent, just one layer down.
**Fix**: make failure-counter persistence an enforced invariant, not best-effort. Distinguish "CAS lost the race" (fine, another writer handled it) from "the write itself errored" (not fine — must not silently continue). On a genuine persistence error, either retry the write with backoff before giving up, or mark the row via an independent circuit-breaker/quarantine mechanism so it stops being selected as a candidate even if the counter never incremented. Add a test: counter write fails repeatedly — prove the row cannot be retried unboundedly (i.e., something stops it, even without the counter's help).

### P1c — `recordRemediationFailure` overwrites the full `validation_report` JSON guarded only by billing_status + retry_count (race with concurrent writers)
File: `web/lib/adapters/SupabasePersistenceAdapter.ts` line ~259. A concurrent writer that changes other `validation_report` fields between this method's read and write (while billing_status/retry_count stay the same) has its changes silently clobbered by this method's stale full-report snapshot.
**Fix**: use an atomic JSONB merge/increment at the DB level instead of a full-object replace (e.g. `jsonb_set` on just the fields this method owns: `remediation_retry_count`, `remediation_last_failure_at`, `remediation_last_failure_stage`), so concurrent unrelated-field writes survive. If a raw SQL/RPC merge isn't feasible quickly, at minimum add an `updated_at`-based CAS guard matching the exact row snapshot this method read, so a stale write fails closed instead of silently winning.
**Test**: simulate a concurrent writer changing an unrelated `validation_report` field between read and write — prove it survives after `recordRemediationFailure` runs.

### P2a — DeepSource findings (5 current-head threads, non-blocking but should be resolved without weakening the rule)
- `web/lib/services/dimension-remediation.ts:322` and `:338` — "unexpected function declaration in global scope" on two `export function` declarations. CC's read: these are standard ESM/TS module-level exports (same pattern as every other function in this file) and DeepSource's rule appears miscalibrated for this monorepo's module system — verify this is really a false positive (check DeepSource's actual config/exclude patterns for `.ts` files in this repo, `.deepsource.toml` if it exists) before concluding that; if it's a real config gap, either fix the `.deepsource.toml` ignore pattern (proper fix) or, only if that's not feasible in scope, wrap as the tool suggests without changing the public export shape.
- `web/lib/__tests__/dimension-remediation.test.ts:163` — same global-scope finding, same investigation.
- `web/lib/__tests__/dimension-remediation.test.ts:253` — redundant `undefined` as a trailing function-call argument — trivial, just remove it.
- `web/lib/adapters/SupabasePersistenceAdapter.ts:259` (`recordRemediationFailure`) — method doesn't use `this`. If it genuinely doesn't need instance state, this is a legitimate signal it could be a static method or plain exported function — but check whether other methods on this same adapter class instance-bind to a shared Supabase client via `this` (likely), in which case this one SHOULD use `this.client` too and its current implementation may itself be a bug (not fetching its client the right way) — investigate before just silencing the finding.

### P2b — This dispatch's OWN prior prompt file is stale/self-contradictory
File: `docs/agent-prompts/2026-09-11-oc-remediation-cron-not-wired.md`. It opens with a correction (no cron gap, real cause is budget-drain) but its ORIGINAL body still instructs adding a `vercel.json` cron entry and auto-remediating `XMA9iZEUL0s`. Rewrite it so the obsolete premise is struck through/clearly marked obsolete everywhere, not just in the added correction section, so a future agent reading only the top doesn't act on stale instructions further down.

### P2c — Test coverage gaps: the adapter's real query is never exercised
File: `web/lib/__tests__/dimension-remediation.test.ts`. Current tests replace `SupabasePersistenceAdapter` with a fake — the actual `recordRemediationFailure` Supabase query chain (the exact `.eq()`/`.or()` filter shape, CAS behavior) is never tested against anything resembling the real client. Add focused contract tests for the adapter itself (absent counter, zero counter, positive counter, Supabase error) similar in shape to the existing reaper CAS tests (`analysis-reaper.test.ts`) for consistency. Also add service-level tests for: fetch() rejecting (network error, not just non-2xx), an empty/malformed worker response stream, the `StitchFailed` path specifically, and a CAS-loss (`{updated:false}`) scenario if not already covered.

### P2d — Fail-closed behavior only proven at the service-function boundary, not the webhook route
File: `web/app/api/webhooks/remediate-dimensions/route.ts`. The service throws on a transcript-query error, but trace whether the route actually propagates that as a non-2xx HTTP response to QStash, or whether it's caught somewhere and converted to a 200 (which would make QStash think the sweep succeeded and not retry — silently skipping work). Add a route-level test proving this. If it currently swallows to 200, fix it while preserving the route's existing authenticated-request handling.

## Gates (ALWAYS INCLUDE)
qa-intel (`pnpm qa-intel:ci` and `--mode diff --base origin/main`, check exit code un-piped), full vitest suite for touched files, `tsc --noEmit`, negative-control where feasible (e.g. prove P1a's starvation bug reproduces before your fix, on the pre-fix code, using a scoped test). Full skill stack per `feedback_mandatory_skill_stack_every_pr` (fresh `ls ~/.claude/skills .claude/skills` enumeration).

## Report format (ALWAYS INCLUDE)
Structured: what was found/fixed per item above, proof (test output, before/after), anything explicitly deferred and why (e.g. if P1c's atomic JSONB merge isn't feasible in scope, say so and explain the interim CAS-guard fallback used instead). Post final [DONE] to ledger, hand back to CC — do not merge yourself.
