# Agent Dispatch Prompt — fix-pr305-abort-config-and-persistence-race

**Target Agent**: OC (DeepSeek/GLM, low effort)
**Effort Level**: low (well-scoped, findings already root-caused by an external reviewer)

---

## 0. Ledger protocol — [ALWAYS INCLUDE]

Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md` before touching any file. Post an
`[IN_PROGRESS]` line with your intent + target files as your FIRST action. Re-check the
ledger after every subtask. Post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of
what actually happened (not what you intended) as your LAST action.

---

## 1. Context

You are in a git worktree on branch `fix/adr021-phase4-live-stream-retry-oc` (tracks
`origin/fix/adr021-phase4-live-stream-retry`, PR #305: "fix(streaming): retry a failed
bundle once, don't abort the whole analysis"). An external code reviewer gave a
detailed, accurate review of this PR's head (`aaab22c3`). The full review is saved at
`docs/agent-prompts/2026-09-11-pr305-external-review-findings.md` — READ IT FIRST, in
full, before writing any code. It contains the exact root cause, code shapes, and file
context for every finding below.

This PR's whole purpose is to make a stuck-analysis remediation cron reachable by
letting one bundle retry instead of aborting the entire analysis. Two of the review's
findings mean the PR currently either (a) doesn't actually change production behavior,
or (b) can silently corrupt persisted state. Both must be fixed for real, not papered
over.

## 2. Task — fix ONLY these two P1s (do not attempt the P2/tangent items, those are
listed separately in the findings doc for a future pass)

### Fix A — ABORT_ON_PARTIAL_FAILURE doesn't reach production
The module constant flip to `false` doesn't matter if the runtime code path reads
`admin_settings.abortOnPartialFailure` from loaded settings, and that persisted/default
value is still `true`. Find where this setting is loaded and consumed at runtime (the
review points at the `useSynthesisConfig`/hook boundary and the Settings Registry —
search for `abortOnPartialFailure` across `web/` and `worker/`). You must:
1. Trace the FULL precedence chain: module constant → default admin setting value →
   persisted DB value → what the hook/route actually reads at the moment it decides to
   abort or not.
2. Fix whichever link in that chain still resolves to `true` in the real deployed path
   — either update the persisted/default admin setting itself, or fix precedence so
   this rollout cannot retain `true`.
3. Add 3 tests: settings loaded with `abortOnPartialFailure: true` (still aborts),
   settings loaded with `false` (doesn't abort), settings unavailable/undefined (falls
   back correctly — and prove what "correctly" means, don't just assert it doesn't
   throw).
4. The existing tests explicitly mock `abortOnPartialFailure: undefined` — do not just
   add more of that; you need a test that mocks a realistic *loaded settings* value.

### Fix B — retry can race a late `interrupted` persistence write
Sequence per the review: attempt 1 errors mid-stream → `attemptBundle` resolves before
the worker's own async abort-persistence write finishes → `attemptController.abort()`
runs → attempt 2 (the retry) succeeds and persists → the DELAYED `interrupted` write
from attempt 1's abort path lands afterward and overwrites attempt 2's good result,
using the same `analysis_id`/`chunk_index`. Net effect: client reports success, DB says
interrupted — this can make a genuinely-recovered analysis invisible to (or falsely
eligible for) the remediation cron.

Fix ONE of these two ways (pick whichever is actually feasible given the code — explain
your choice in your `[DONE]` report):
- (preferred if feasible) Make the retry `await` the failed attempt's persistence /
  cancellation path to fully settle BEFORE starting attempt 2, so there's no window for
  a race.
- (fallback) Make the persistence write monotonic / conflict-aware: an `interrupted`
  status write must never overwrite an already-`complete`/successful write for the same
  `analysis_id`+`chunk_index` (e.g. a WHERE clause guard on current status, or a
  updated_at/version check — look at how other parts of this codebase already do
  CAS-style guarded writes, e.g. `analysis-requeue.ts`'s `tryRequeuePartial` pattern
  mentioned in the ledger history, for the idiom this codebase uses).

Add a test that specifically simulates the race: attempt 1's error resolves, retry
attempt 2 succeeds and persists, THEN the delayed interrupted write from attempt 1
fires — assert the final persisted state is still the good result, not overwritten.

## 3. Skills / gates — [ALWAYS INCLUDE]
Before finishing: `pnpm --filter @hex-yt-intel/web tsc --noEmit` (or worker equivalent
for any worker-side file touched), full `vitest run` for touched suites, qa-intel via
`pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare` (redirect to a file and
check `$?` directly — NEVER pipe through `tail`/`grep`/`head` before checking the exit
code, that has caused false "clean" reports in this project before). Apply
`race-condition-guard` skill thinking explicitly to Fix B (this is exactly the TOCTOU/
lost-update class it covers).

## 4. Report format
On `[DONE]`: which precedence link was broken for Fix A and what you changed; which of
the two approaches you took for Fix B and why; the 4 new/changed tests and what each
proves; real gate results (tsc/vitest/qa-intel, exit codes captured without pipes);
commit SHA; confirm pushed to `fix/adr021-phase4-live-stream-retry-oc`. Do NOT open a
new PR or merge anything — CC will audit and decide how this rolls into PR #305.
