# PR #305 External Review Findings (2026-09-11, pasted by user)

PR: fix(streaming): retry a failed bundle once, don't abort the whole analysis
Branch: fix/adr021-phase4-live-stream-retry
Reviewed head at time of review: `aaab22c` (7 commits) — reviewer notes several
pending checks were still attached to older heads (`83c1880e`, `7bd806bd`, `b9645fd1`)
and should be re-run fresh on the current head before any merge decision.

Status at review time: Codacy/DeepSource failing, checks not fully current for aaab22c.

## Blocking (hold merge on these two)

### P1 — ABORT_ON_PARTIAL_FAILURE config change may not reach production
Changing the module constant to `false` doesn't change the runtime path, which uses
the loaded `admin_settings.abortOnPartialFailure` (persisted/default apparently still
`true`). New tests mock `abortOnPartialFailure: undefined`, so they only exercise the
constant fallback, not the deployed settings path. Production can keep aborting on
first failed bundle even though the PR looks like it disables that.
Fix: update persisted/default admin setting or fix precedence so rollout can't retain
`true`; add tests for settings=true, settings=false, settings-unavailable-fallback;
verify effective value at the useSynthesisConfig/hook boundary, not just the constant.

### P1 — Retry can race a late `interrupted` persistence write
Flow: attemptController.abort() then `outcome = await attemptBundle(...)`. Worker's
disconnect/abort path can still async-schedule an `interrupted` chunk persistence
using the same analysis_id/chunk_index. Sequence: attempt1 errors mid-stream →
attemptBundle resolves before worker-side abort persistence finishes → attempt1
aborted → attempt2 succeeds and writes → delayed interrupted write lands after and
overwrites the good result. Client reports success while storage ends up
missing/interrupted — can silently break remediation cron eligibility.
Fix: retry must await completion of the failed attempt's persistence/cancellation
path, OR persistence must be monotonic so an interrupted result can never replace a
completed one.

## Non-blocking but should be addressed

- P1/P2 — every failed outcome retries, including deterministic whole-video errors
  (ERR_NO_TRANSCRIPT, ERR_TRANSCRIPT_PIPELINE_UNAVAILABLE, other non-transient
  4xx/config/schema failures). Same transcript context → retry can't change result →
  5-bundle config can produce 10 worker attempts on a captionless video, doubling
  cost and delaying the real error. Add a retryability gate before the 2nd attempt.
- P2 — abort-before-retry test only checks `firstAttemptSignal?.aborted === true`
  after the whole analysis completes, not that it was already aborted at the moment
  the second worker request fired. Capture the 2nd request and assert inside the
  fetch mock; also simulate delayed persistence to model the race above.
- P2 — exhausted-retry test expects store status `'complete'` when one bundle failed
  — ambiguous vs backend billing/remediation metadata which tracks partial/failed.
  Need explicit contract: complete vs partial vs complete-with-warning, and that the
  UI actually surfaces missing dimensions, not just the Zustand status.
- P2 — no integration test past the client store: doesn't verify which chunks
  persisted after a bundle exhausts retry, that billing_status stays non-complete,
  that validation_report.status is 'partial', that remediation query selects the row,
  or that a later remediation run doesn't overwrite good chunks with interrupted data.
  Since the PR's whole purpose is making the remediation cron reachable, this is the
  main missing contract test.

## Tangents (not blockers, worth a follow-up ticket)

- No backoff/retry budget beyond one attempt — a transient worker outage could cause
  all bundles to retry simultaneously, adding load during an outage.
- Retry preserves full transcript context and full compute cost — needs a
  retryability/error-class policy to run at scale.
- `.memory/AGENT_LEDGER.md` changes bundled into this PR add merge-conflict/churn
  risk to a code-change PR; not functional but should be kept out where possible.

## Recommended fix order (per reviewer)
1. Fix persisted/admin setting precedence (production activation gap).
2. Close the interrupted-persistence race.
3. Add retryability filtering for deterministic/permanent failures.
4. Add tests for abort ordering and persisted partial output.
5. Re-run all checks on the current head (especially Codacy/DeepSource), not stale
   heads.

Reviewer explicitly said: hold the PR on items 1 and 2 — config issue can leave the
fix inactive in prod; persistence race can report a recovered bundle while durable
storage says it failed.
