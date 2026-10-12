# Agent Dispatch Prompt — chat cascade deadline (stream A)

**Target Agent**: CCT (Claude executor)
**Effort Level**: medium

## 0. Ledger protocol — [ALWAYS INCLUDE]
Follow CLAUDE.md §2: read .memory/AGENT_LEDGER.md and .memory/ADRS.md; post [IN_PROGRESS] first; [DONE] last. Never merge; CC is the sink.

## 1. Context
worker/src/chat-stream.ts `streamChatCascade` applies only a per-attempt AbortSignal.timeout(timeoutMs); there is no cumulative budget across fallback models. The client disconnect signal (`c.req.raw.signal`) is not threaded into the cascade. The catch block does not distinguish client abort. An in-band OpenRouter SSE error with no text is reported as reason 'error', not 'stream_error'. T20 moved timeoutMs into the Settings Registry; it arrives as the `timeoutMs` argument.

## 2. Directives
1. One cumulative budget per cascade, computed once at start. Each attempt gets only the remaining time. When the budget is spent: no further models, one Sentry report.
2. Add `clientSignal?: AbortSignal` as a new 9th parameter of streamChatCascade. Combine it with the per-attempt timeout via AbortSignal.any(). Never start a fallback model when clientSignal is already aborted.
3. catch: client aborted => reason 'client_abort' (console.log only, no Sentry). TimeoutError => 'timeout'. Other AbortError => 'cancelled'.
4. In-band error chunk: if text already streamed, return partial:true (existing path). If no text, report reason 'stream_error' and try the next model.
5. Confirm request-abort support in worker/wrangler.toml. Cloudflare docs: request.signal needs the `enable_request_signal` compatibility flag. Add it at top level only, next to nodejs_compat.
6. Tests in worker/src/__tests__/chat-cascade-deadline.test.ts:
   (a) client abort mid-stream aborts the current fetch; no next model is called; no Sentry capture.
   (b) fallback models share one budget; second model gets the remaining time; cascade stops when spent (fetch count 2, not 3).
   (c) text chunk then in-band error => partial:true, one fetch, Sentry tag reason 'stream_error'.
   (d) in-band error before any text => next model tried, reason 'stream_error'.
   Each new test must fail without the fix; record the negative-control result.
   The existing AbortError expectation in worker/src/__tests__/chat-cascade-fallback-capture.test.ts changes from reason 'error' to 'cancelled' per directive 3.

## 3. Skills decision tree (ALWAYS)
code-reviewer, simplify, review-delta, review-duplication; qa-intel in --mode diff AND --mode full; contract-auditor; race-condition-guard (shared-state concurrency); silent-failure-hunter (catch blocks). Write `$(git rev-parse --git-dir)/skill-gates-ok`: line 1 = HEAD sha, then one line per skill actually run.

## 4. Gates
- `cd web && pnpm exec tsc --noEmit -p .`
- `cd web && NODE_OPTIONS=--max-old-space-size=3072 pnpm exec vitest run ../worker/src/__tests__/`
- `pnpm run -s qa-intel:ci` from repo root; must print "No new issues". Fix own findings; never baseline them.
- `cd web && pnpm run -s contract-audit`

## 5. Tenets (ALWAYS)
1. E2E traversal: trace the signal from the route handler through streamChatCascade and the catch block.
2. Contract enforcement: keep the existing return shape.
3. Hunt tangents within scope only; report, do not fix.
4. Run verification skills and gates before reporting.

## 6. Report (ALWAYS)
RCA -> Contract -> Fix -> E2E proof -> Tangents -> Deviations -> Skills Run -> Gates -> Files changed. Under 250 words. Negative-control result per test. Do not stage scripts/commit-guard/__pycache__.
