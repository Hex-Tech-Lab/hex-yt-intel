# Agent Dispatch Prompt — PR #211: Replace Tautological Tests with Real Ones, Add Missing Reliability Fixes, Rebase

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — read it now
if you haven't already. Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md`
before touching any file; post `[IN_PROGRESS]` with intent + target files as
your first action; re-check the ledger after every subtask; post
`[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually
happened (not what you intended) as your last action.

## 1. Context

PR #211 (`fix/unverified-endpoint-audit`, branch based on an old `main`
commit) was dispatched to resolve 16 `UNVERIFIED_ENDPOINT_NO_TEST`
contract-auditor findings. It found and fixed 3 real production bugs
(QStash `/v2/events` → `/v2/logs` endpoint drift, a missing OpenRouter
provider prefix on the embeddings model ID, and an undocumented OpenRouter
auth path with a documented-path-first + legacy fallback) — **these three
fixes are independently confirmed correct** (CC verified the QStash one
directly against live Upstash docs). The problem is the tests: a follow-up
review found, and CC independently confirmed by reading every flagged file,
that **every one of the ~12 new `*.test.ts` files imports ONLY `describe,
it, expect` from vitest — none of them import or call the actual
production module they claim to test.** They assert local literal strings
against themselves. This satisfies contract-auditor's simplistic
"sibling test file exists" check but provides ZERO actual protection
against the exact drift class this whole task existed to prevent — if any
of the 3 real fixes were reverted tomorrow, none of these tests would fail.

This is a confirmed, severe finding, not a stylistic nitpick. The task now
is to make the tests real, plus close several other real gaps the same
review surfaced.

## 2. Task

**2a. Rebase.** The branch is currently `CONFLICTING` against `main` (GitHub's
own mergeable status). `git fetch origin main && git rebase origin/main`
(or merge, whichever this project's convention prefers — check recent PR
history) and resolve conflicts. Likely hotspots: `web/vitest.config.ts`
(touched by concurrent ADR-024 work, now merged/in-progress on `main` —
read `main`'s current version fully before resolving, it uses
`@vitejs/plugin-react` now, not a manual `oxc`/`esbuild` JSX override —
keep that, don't reintroduce an old approach) and `.memory/AGENT_LEDGER.md`
(append-only, keep both sides' entries).

**2b. Rewrite every tautological test to actually exercise production
code.** For EACH of the following files, the pattern is: mock
`global.fetch` (or whatever HTTP client the module uses), import and call
the REAL exported function, assert the REAL request (URL, method, headers,
body) and REAL response-parsing behavior — not a local copy of the
expected values re-typed into the test file.
- `web/lib/admin-logs/fetchers.test.ts` — exercise `fetchQstashLogs`,
  `fetchSupabaseLogs`, and the other admin-logs fetchers this file covers.
- `web/app/api/admin/logs/qstash/route.test.ts` — import the actual route,
  mock `requireAdmin`/auth and `fetchQstashLogs`, invoke `GET`, assert
  delegation + auth + response mapping.
- `web/app/api/admin/logs/supabase/route.test.ts` — same pattern; ALSO fix
  the review's separate finding that this test's asserted URL contradicts
  the fetcher's real endpoint (Management `/logs` vs the real
  `/analytics/endpoints/...` path) — verify which is actually correct
  against the real fetcher code, don't just pick one.
- `web/lib/embeddings.test.ts` — exercise the real embedding function, mock
  fetch, assert the request body actually contains
  `openai/text-embedding-3-small` (not a locally-declared copy of that
  string).
- `web/lib/adapters/OpenRouterCompletionAdapter.test.ts`,
  `web/lib/services/openrouter.test.ts`,
  `web/lib/intelligence/relations-engine.test.ts`,
  `worker/src/chat-stream.test.ts`,
  `worker/src/services/CommentClassifier.test.ts`,
  `worker/src/services/LLMCascade.test.ts` — same pattern for each: mock
  fetch, invoke the real function, assert the real URL/request/response
  handling.
- `web/lib/services/dimension-remediation.test.ts` — exercise the real
  `getRemainingBudgetCents`/`fetchKeyInfo` functions (may need to export
  `fetchKeyInfo` from the module if it isn't already, or test through the
  public `getRemainingBudgetCents` entry point with mocked fetch sequences
  covering: primary `/key` success, primary failure → legacy `/auth/key`
  success, both fail → 0 (fail-closed), malformed `limit_remaining`).
- `web/lib/env.test.ts` — import the real fallback logic/value from
  `env.ts` (export `MOCK_DEFAULTS` narrowly if needed) rather than
  re-declaring the expected URL as a separate literal in the test.

If a function needs a small export/seam change to be testable without a
live network call, make that narrow change (e.g. exporting an
internal helper) — don't restructure the module more than necessary.

**2c. QStash pagination + timeout (real gap, not just tests).**
`fetchQstashLogs` in `web/lib/admin-logs/fetchers.ts`: the corrected
`/v2/logs` endpoint is paginated (`cursor` field in the response) but the
code doesn't follow cursors or pass date-range filters — for a busy/older/
custom-range admin query this can silently return incomplete results. Add
cursor-following with a bounded page count (don't loop forever — cap it,
matching this project's "no hardcoded magic numbers, justify every
tunable" convention) and pass whatever date-filter parameters the QStash
logs API actually supports (verify against the same docs page used
earlier: https://upstash.com/docs/qstash/api-reference/logs/list-logs).
Also add a timeout/AbortController to this fetch call — it currently has
none, so a stalled Upstash request can hang the Next.js route
indefinitely, unlike this project's established dual-timeout pattern
elsewhere (check `CLAUDE.md` §1 "Law #2: Stratified Dual-Timeouts" for the
project's standard here).

**2d. dimension-remediation.ts reliability + observability gaps.**
- `fetchKeyInfo` (both the primary and legacy-fallback calls) has no
  timeout — add one, matching 2c's timeout pattern.
- When the primary `/key` endpoint fails but the legacy `/auth/key`
  fallback succeeds, NOTHING is reported to Sentry — silent dependency on
  a legacy/possibly-deprecated endpoint could persist indefinitely
  undetected. Add a `Sentry.captureMessage` (not `captureException` — it's
  a recovered-via-fallback case, not a hard failure) with endpoint/status
  context when this specific fallback path is taken.
- The new `console.warn`/`console.error` calls in this file don't follow
  this project's structured log format (a stable `[tag]` prefix + context
  object, matching the pattern already used elsewhere in this same file
  and across the codebase) — fix to match.

**2e. DeepSource findings on dimension-remediation.ts.** Check
`gh pr view 211 --json comments` or the DeepSource check's own report for
the EXACT current findings (missing doc comment on `getRemainingBudgetCents`,
possibly a global-scope-declaration style issue) — resolve them for real,
don't guess. Re-run the DeepSource check (or verify locally if there's an
equivalent lint rule) before considering this closed.

**2f. `web/vitest.config.ts` test-discovery approach.** The review flags
that this PR's version used an explicit narrow file allowlist (recreating
the original discovery gap for FUTURE tests) instead of the broad glob
pattern. By the time you rebase (2a), `main`'s `vitest.config.ts` will
already have ADR-024's broad-ish include globs
(`hooks/**/*.test.{ts,tsx}`, `components/**/*.test.{ts,tsx}`,
`store/**/*.test.{ts,tsx}`, plus the original `lib/__tests__/**`) — check
whether that already covers where you're placing these test files, or
whether you need a `lib/**/*.test.ts` (or similarly-scoped) addition for
`web/lib/admin-logs/`, `web/lib/adapters/`, `web/lib/services/`,
`web/lib/intelligence/`, `web/app/api/admin/logs/`, and `worker/src/services/`
sibling test files. If a blanket glob resurrects pre-existing broken tests
(the previous agent found 3: `error-handler.test.ts`,
`KnowledgeHistoryService.test.ts`, `wiki-builder.test.ts`) — verify those
are STILL actually broken (don't assume), and if so, use a scoped glob
that includes real coverage but explicitly excludes those 3 known-broken
files by name, not a narrow allowlist of only this PR's own new files.

## 3. Goal / definition of done

Every test file listed in 2b actually imports and calls its corresponding
production function, with mocked fetch, asserting the REAL request/response
contract — verified by the negative-control method this project uses
elsewhere: temporarily revert one of the 3 real fixes (e.g. put back
`/v2/events` or the bare `text-embedding-3-small` model id) locally, confirm
the corresponding test NOW FAILS, then re-apply the fix and confirm it
passes again. Do this for at least the 3 confirmed-real-bug fixes (QStash,
embeddings, OpenRouter key endpoint) — don't just trust that mocking fetch
and calling the function makes a test meaningful without proving it can
actually fail.

## 4. Expected results

- Rebased cleanly onto current `main`, no conflicts, `web/vitest.config.ts`
  matches main's ADR-024 state (uses `@vitejs/plugin-react`) plus whatever
  discovery-glob addition 2f determines is needed.
- All ~12 test files rewritten to bind to real implementation code.
- QStash pagination + timeout added.
- dimension-remediation.ts timeout + fallback-observability + log-format
  fixes applied.
- DeepSource findings on dimension-remediation.ts resolved.
- Negative-control proof for the 3 confirmed real-bug fixes.

## 5. Task-specific skills/tools/plugins/MCPs

CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets are
[ALWAYS INCLUDE] below. Beyond that: `owasp-top-10` doesn't strictly apply
here but double-check none of the new mocked-fetch tests accidentally
leak a real credential into a committed fixture. Supabase MCP not needed
for this pass (no new live-DB verification required — the endpoint
verification was already done in the prior pass).

## 6. Fixtures

Run `code-review-graph`'s `build_or_update_graph_tool` then
`get_review_context_tool` scoped to all files listed in §2 before reading
full files. Start from PR #211's branch `fix/unverified-endpoint-audit` —
`git fetch origin fix/unverified-endpoint-audit && git checkout fix/unverified-endpoint-audit`
— then immediately do the rebase in 2a before anything else, since the
branch's current base is stale.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** For each rewritten test, state
   what production behavior it now actually binds to, then prove it with
   the negative-control method in §3 — not just "test passes."
2. **E2E cycle complete.** A test that mocks fetch and calls the function
   is not automatically meaningful — the negative-control proof is what
   makes it real evidence, not the mock's mere existence.
3. **Tangent hunt.** While rewriting each test, check whether the
   corresponding production file has OTHER unverified assumptions the
   original UNVERIFIED_ENDPOINT_NO_TEST pass might have missed. Report
   tangents found even if not fixed this pass.

**If you cannot complete a full cycle or find a design gap, STOP and
report the specific deviation and why.**

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (negative-control results for the 3
real-bug fixes, not just "tests pass") → Tangents found → Deviations
flagged → Skills run + findings → Gates → Files changed. CC independently
re-verifies every claim against real code and real system state before
accepting — including spot-checking that rewritten tests actually import
the production module (the exact class of thing that was wrong last time).

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' — empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # EXACT CI flags, not the bare default run
pnpm tsx web/scripts/contract-auditor.ts
```

## 10. PR

Push to the SAME branch (`fix/unverified-endpoint-audit`, PR #211) —
don't open a new PR. Do not merge — CC will independently re-verify
(including spot-checking real imports in the rewritten tests) and merge.
