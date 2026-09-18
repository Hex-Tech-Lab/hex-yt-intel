# Agent Dispatch Prompt — Fix PR #315 (fix/pr313-review-findings) review findings: body-level timeout gap, 4xx retry-arming bug, malformed-payload stuck-loading

**Target Agent**: OC (opencode, GLM 5.3 Flash, low effort)
**Effort Level**: low (well-scoped, narrow findings)

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full.** Read
> `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md` before touching any file;
> post `[IN_PROGRESS]` with intent + target files first; post
> `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary last.

---

## 1. Context & Problem Statement

PR #313 (chat/WordCloud/Chapters connection-drop resilience) is already
MERGED to main. This branch (`fix/pr313-review-findings`, worktree
`.claude/worktrees/oc-pr313-review-findings`, currently `6fc25b9d` after a
merge with `main`) already has a first round of fixes (`47eef47c` "unified
fetch retry budget, request timeouts, stale-flag reset") for a first review
round's P0s (no-network-rejection-retry, no-AbortController). A SECOND
review round on that exact commit found the retry/timeout work still has 3
more real production-blocking gaps. You are extending the existing
`fetch-with-timeout.ts` shared helper and `useKnowledgeGraph.ts`, not
rewriting them from scratch.

## 2. Contract & Implementation Directives

Work in this worktree (already checked out, merged with main, no
conflicts): `.claude/worktrees/oc-pr313-review-findings`, branch
`fix/pr313-review-findings`. Do NOT create a new branch or worktree.

### P0 — shared timeout only covers header arrival, not body consumption
File: `web/lib/utils/fetch-with-timeout.ts` and its 3 callers
(`useKnowledgeGraph.ts`, `useAutoRestoreAnalysis.ts`, `useChapters.ts`).

**Problem**: `finally { clearTimeout(timer) }` runs as soon as `fetch()`
resolves HEADERS. If `response.json()` then stalls (body never arrives /
never completes), the timer is already cleared and the retry loop stays
blocked forever — this recreates the exact "stuck until reload" bug the
original fix was written to prevent, just one layer deeper.

**Fix**: change `fetchWithTimeout`'s API so the timer stays armed through
body consumption — e.g. a callback-based shape:
`fetchWithTimeout(url, init, consumeResponse: (res: Response) => Promise<T>): Promise<T>`
where `consumeResponse` runs INSIDE the timeout window, not after it's
cleared. Update all 3 callers to pass their `response.json()` (or
equivalent) call through this callback instead of consuming the response
after `fetchWithTimeout` returns. Preserve fake-timer compatibility (the
existing tests use `vi.useFakeTimers()` — don't break that). Add a
regression test where `fetch()` resolves a `Response` but `.json()` never
settles — assert the timeout still fires.

### P0 — `useKnowledgeGraph.ts`: malformed/empty 200 body leaves `loading` stuck
File: `web/hooks/useKnowledgeGraph.ts`.

**Problem**: `lastAttemptFailed = false`, `res.json()`, and entity/edge
mapping were moved OUTSIDE the `try/catch` in the existing fix. The hook is
launched via bare `void fetchGraph()`, so a thrown parse/mapping error is an
unhandled rejection — `loading` never settles, no retry is scheduled, no
error is surfaced.

**Fix**: move JSON parsing, payload validation, entity/edge mapping, AND the
final state updates back INSIDE the bounded try/catch error path. Do NOT
clear `lastAttemptFailed` until the response body has been parsed AND
accepted as valid. Treat malformed body data as a RETRYABLE failure (same
bounded-retry budget as a network error), settle `loading` once the retry
budget is exhausted (don't leave it stuck forever), log/capture the original
parse error (Sentry, matching this hook's existing error-capture pattern).
Add tests: invalid JSON body, and a valid-JSON-but-malformed
`entities`/`relations` shape.

### P0 — `useKnowledgeGraph.ts`: permanent 4xx incorrectly re-arms online-retry
File: `web/hooks/useKnowledgeGraph.ts`.

**Problem**: the non-5xx response branch unconditionally sets
`lastAttemptFailed = true`. The hook's own inline comment documents 4xx as
"permanent" but the `online` event listener doesn't check for that — every
later connectivity-transition event re-fetches a 401/404 that will never
succeed.

**Fix**: classify retryable (network error, timeout, exhausted 5xx retries)
vs. permanent (any 4xx) failures explicitly and separately. On a 4xx:
settle `loading`, mark it non-retryable, and leave `lastAttemptFailed =
false` so the `online` listener does NOT re-arm. Add a test proving multiple
`online` events do NOT trigger a refetch after a 401/404.

### P1 — refactor `fetchGraph` for complexity (do after the 3 P0s above)
File: `web/hooks/useKnowledgeGraph.ts`.

DeepSource flags high cyclomatic complexity (retry + HTTP classification +
parsing + normalization + state mutation all combined in one function) and
an async function returning a value from a `Promise<void>` path. Split into
small helpers: request/retry classification, response parsing/mapping,
terminal-failure handling. Where the function's return type is `Promise<void>`,
replace `return fetchGraph(...)` with `await fetchGraph(...); return;`.
Preserve retry timing and cancellation behavior exactly — this is a
refactor, not a behavior change; run the full test suite before/after to
confirm.

### P1 — extend resilience test coverage
File: `web/hooks/useKnowledgeGraph.test.tsx`.

Add tests for: 401/404 + repeated `online` events (no refetch), invalid
JSON, malformed entity/relation payloads, and a `Response` whose body/`.json()`
never settles. Assert `loading` settles correctly in every case, retry
budget is respected, `lastAttemptFailed` state is correct, and there's no
redundant `online`-triggered refetch after a permanent failure.

### P1 — propagate the body-timeout fix to the other 2 shared-helper callers
Files: `web/hooks/useAutoRestoreAnalysis.ts`, `web/hooks/useChapters.ts`.

Both inherit the body-stall gap via the shared helper. After fixing
`fetchWithTimeout` itself, add body-consumption-timeout tests for
auto-restore (check + full-record paths) and chapters — verify each hook
correctly enters its existing retry/error path and that `restoring`/chapter-
loading state cannot remain permanently stuck.

### P1 — don't let `fetchWithTimeout` silently break future caller cancellation (only if time permits)
File: `web/lib/utils/fetch-with-timeout.ts`.

The helper currently always overwrites `init.signal` with its own timeout
controller's signal — a future caller passing its own `AbortSignal` (e.g.
for unmount-cancellation) would silently lose that ability. No CURRENT
caller passes a signal, so this isn't an active bug, but define the
contract explicitly: either compose caller-signal + timeout-signal (if
there's a clean way to do this without a new dependency), or document +
test the override behavior so it's an intentional contract, not an
accident. Add tests for caller-abort and timeout-abort if you implement
composition.

### P2s — do these last, only after all P0/P1 above are done and tests pass
- `fetchWithTimeout`: DeepSource flags missing function-level docs + a
  global-scope-pattern rule violation — add a one-line doc comment, adjust
  module/function shape to satisfy the rule without behavior change.
- `useAutoRestoreAnalysis-resilience.test.tsx`: cleanup (`vi.unstubAllGlobals()`,
  `unmount()`) currently happens at the end of each test body, not in
  `afterEach` — move it to `afterEach` so a failed assertion doesn't leak
  the global `fetch` stub into later tests.
- Same test file: a comment claims the restore fixture is identical to a
  sibling fixture, but `analysis_payload` is `{}` here vs. populated there —
  either import a real shared fixture, or fix the comment to say it's
  intentionally reduced (whichever is actually true — check the sibling
  file first, don't guess).
- `web/lib/admin-logs/fetchers.test.ts`: the fetcher-wiring guard now
  depends on exact `Promise.all([ ... ]);` source-text formatting — replace
  with an AST/source-structure check (or a shared source-of-truth list) so a
  valid route refactor doesn't produce a false test failure. Keep the
  existing negative-control test (an omitted fetcher must still fail).
- `docs/agent-prompts/2026-09-15-oc-pr313-review-findings.md` claims
  resilience coverage across "chat" but the audit only covered graph,
  restore, chapters — `useChatStore` was never checked. Audit
  `useChatStore` separately for network rejection, timeout, outbox retry,
  online recovery, cancellation, user-visible error behavior. If its outbox
  architecture makes it structurally exempt from the shared fetch helper,
  say so explicitly in your report and add one focused contract test
  proving the exemption is safe — don't just skip it silently.

## Negative-control tests — MANDATORY, every P0/P1 fix above

For each of the 3 P0s specifically: reproduce the ORIGINAL bug first (prove
the pre-fix code actually hangs / re-arms / stays stuck), THEN prove the fix
resolves it. A before/after pair, not just an after-only assertion.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

Match against the LIVE skill list (`ls ~/.claude/skills .claude/skills`), do
not recall from memory. Given the touched files:
- **ALWAYS**: `qa-intel` (BOTH `--mode diff` AND `--mode full`),
  `code-reviewer`, `simplify`, `review-delta`, `review-duplication`,
  `contract-auditor`.
- **FE/hooks** (`web/hooks/**`): `react-best-practices` (hook deps, stale
  closures — this task is directly about a stale-closure-shaped retry bug).
- Run `build-graph`/`get_impact_radius_tool` (Step 0) before editing to
  confirm every caller of `fetchWithTimeout` is accounted for (3 known —
  confirm no 4th exists).

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm dlx tsx scripts/verify-quality-engine.ts --mode full --ci
pnpm exec tsx web/scripts/contract-auditor.ts
```

## 4b. External CI

Push to `fix/pr313-review-findings` (PR #315, already open) and confirm via
`gh pr checks 315` that CI is green and no new failures were introduced.

---

## 5. The Three Tenets — [ALWAYS INCLUDE]

> 1. **Contract definition + enforcement.**
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

## 6. Report Format — [ALWAYS INCLUDE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

Additionally, flag for CC's qa-intel follow-up wave: is
"timer-cleared-before-body-consumed" (the body-level timeout gap) or
"retry-flag-armed-on-permanent-failure" (the 4xx bug) generalizable enough
to become a static-analysis rule? Note any OTHER fetch/timeout call sites in
the codebase that might share either pattern (a quick grep, not a full
audit) — CC designs the rule, you just flag the candidate + location.

Do NOT merge or close the PR yourself — CC is sink orchestrator, push and
report, CC verifies against real sources and merges.
