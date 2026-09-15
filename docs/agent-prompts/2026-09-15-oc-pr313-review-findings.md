# OC Dispatch — fix PR #313 post-merge review findings (real gaps in the resilience fix itself)

Built from `docs/agent-prompts/TEMPLATE.md`. Model: OC (opencode, GLM 5.3 Flash, low effort).

## Ledger protocol (ALWAYS INCLUDE)
1. Read `.memory/AGENT_LEDGER.md` before touching any file — note PR #313 (merged `2786f9d0`) and any concurrent `fix/pr312-review-findings` dispatch that may touch overlapping files.
2. Append `[IN_PROGRESS] OC <timestamp> — dispatch-oc-pr313-review-findings: <intent>, target files`.
3. Flip to `[DONE]` when finished. Do not merge yourself.

## Environment note
You cannot read or write ANY path outside this worktree directory. Scratch files stay inside this worktree, delete before finishing.

## Step 0 (ALWAYS INCLUDE)
Use `code-review-graph` MCP tools before Grep/Read where available.

## Context (FILL IN)

PR #313 (merged `2786f9d0`) added connection-drop resilience (retry+backoff+online-recovery) across chat, WordCloud (`useKnowledgeGraph`), `useAutoRestoreAnalysis`, and `useChapters`, in direct response to a user-reported internet-disruption incident. A post-merge review found the resilience fix itself has real gaps that undermine its own stated purpose — verified directly by CC before this dispatch (not just trusting the review):

- `web/hooks/useKnowledgeGraph.ts` line ~97: `if (res.status >= 500 && attempt < MAX_GRAPH_FETCH_RETRIES)` — **only** retries on an HTTP 5xx response. A raw network-level rejection (`fetch()` throwing `TypeError: Failed to fetch`, e.g. from a dropped connection — the EXACT scenario in the original incident report) is caught by the outer `catch (error)` block, sets `lastAttemptFailed = true`, and then relies ENTIRELY on the `window.addEventListener('online', ...)` handler to recover — it never re-enters the bounded 5s/10s/15s retry schedule the fix was supposed to provide.
- Same file: the `fetch()` call has **no `AbortController`/timeout anywhere**. A request that never settles (a stalled/hanging connection, not a clean rejection) blocks forever inside `await fetch(...)` — the retry logic can't even run because it's gated on the fetch promise settling first. This can recreate the exact "stuck until reload" class of bug the fix was written to prevent.
- `lastAttemptFailed` does not appear to be reset to `false` after a successful recovery — a later `online` event after a since-succeeded fetch would likely retrigger an unnecessary refetch (confirm and fix if real).

## Task

### P0a — Network-level fetch rejections must share the same retry budget as 5xx
File: `web/hooks/useKnowledgeGraph.ts`. Restructure so a thrown/rejected `fetch()` (network error) and a `status >= 500` response both go through the SAME bounded retry driver (`MAX_GRAPH_FETCH_RETRIES`, same backoff). Keep 4xx as permanent/non-retryable. The `online`-event recovery path should remain as a LAST-RESORT recovery after the bounded retries are exhausted, not the only recovery mechanism for one specific failure mode.
**Test**: an immediate `fetch()` rejection (not a 4xx/5xx response) must retry the same way a 500 does.

### P0b — Add a request timeout so a stalled fetch can't block the retry loop from ever running
Same file. Wrap the `/graph` fetch in an `AbortController` with a reasonable timeout (check this repo's existing timeout conventions — e.g. `analysis.llmCascade.handshakeTimeoutMs` pattern, or a simpler hardcoded value if this isn't a registry-backed tunable elsewhere; use judgment, don't over-engineer a Settings Registry entry for a client-side UI fetch unless an existing precedent says otherwise). A timeout should count as a retryable failure (same bucket as 5xx/network-error from P0a), not a permanent one.
**Test**: a `fetch()` that never resolves must still enter the retry schedule via the timeout, not hang forever.

### P1a — `lastAttemptFailed` must reset on success
Same file. Confirm whether a successful fetch resets `lastAttemptFailed = false`. If not, fix it, and add a test: one successful recovery must not cause a later `online` event to retrigger a redundant fetch.

### P1b — Audit `useAutoRestoreAnalysis.ts` and `useChapters.ts` for the same two gaps (P0a/P0b)
The reviewer flagged these as "high-confidence, not fully confirmed from the visible diff" — actually check their fetch calls. If they share the same 5xx-only-retry and/or no-timeout gaps, fix them the same way as P0a/P0b (reuse whatever helper/pattern you build for `useKnowledgeGraph.ts` rather than three divergent implementations — but don't force a shared abstraction if the three hooks' fetch shapes are meaningfully different; use judgment per this repo's simplicity-first standard).

### P2 — Strengthen the admin-logs snapshot regression test
File: `web/lib/admin-logs/fetchers.test.ts` (the "snapshot route wiring" test CC added). The reviewer notes it only checks that each fetcher's NAME appears as a substring in the route file's source text — it doesn't verify the call actually happens inside the `Promise.all(...)` array (a fetcher name could appear in a comment or an unrelated string and still pass). Decide whether this is worth tightening (e.g. a regex anchored to the `Promise.all([` block) or whether the current simple text-match is a deliberately-acceptable tradeoff for a regression guard whose only job is "don't silently forget to wire a fetcher in" — if you tighten it, keep the negative-control property (a reverted fetcher must still fail the test).

### P3 — User-visible terminal error/retry state for WordCloud
If, after the retry budget is exhausted (P0a/P0b's fix), there's still no user-visible feedback that the WordCloud/graph permanently failed for this session (vs. just silently staying empty), consider whether the existing UI (check `DashboardContainer`/WordCloud panel) already surfaces this adequately. Only add a new UI affordance if genuinely missing — don't add a redundant error banner if the panel already handles an empty/failed state reasonably.

## Gates (ALWAYS INCLUDE)
Run the EXACT CI command, not just `--mode diff`: `pnpm run qa-intel:ci` (this project's own memory explicitly warns the two modes can disagree — CC repeated this exact mistake on PR #313 itself, don't repeat it a third time). Also `--mode diff --base origin/main` as a secondary check. Full vitest suite, `tsc --noEmit`. Full skill stack per `feedback_mandatory_skill_stack_every_pr`.

## Report format (ALWAYS INCLUDE)
For each item: confirmed root cause, fix, proof (test output). Post final `[DONE]` to ledger, hand back to CC — do not merge yourself.
