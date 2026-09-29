# Agent Dispatch Prompt — HOTFIX: shared dedupe aborts the response body (highlights show "No highlights yet")

**Target Agent**: OC (opencode) — model `glm-preset/@preset/glm-53-flash-on-cheap` (CLAUDE.md "OC model standard" v4)
**Effort Level**: medium

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

## 1. Context & Problem Statement (root cause already confirmed by CC — do not re-derive; verify it)

Live report 2026-09-29: the highlights panel shows "No highlights yet", and "Check Status" does nothing, for analysis `0b4918dd-0feb-4f30-b00d-153bb5969508`, which HAS 16 rows in `analysis_highlights`. RLS returns all 16 to the owner (CC-verified by SQL), and `/api/analyses/highlights` returned HTTP 200 for every request (Vercel logs).

Root cause, in `web/lib/utils/dedupe-fetch.ts` (`dedupedFetch`):
- Every consumer's wrapper promise runs `.finally(() => detach())` after `currentEntry.promise` resolves.
- `currentEntry.promise` resolves when the response HEADERS arrive, not the body.
- `detach()` does `if (currentEntry.consumers === 0) currentEntry.controller.abort();`. When the last consumer detaches, it aborts the shared fetch while the BODY is still streaming.
- Each consumer received `res.clone()`. Aborting the underlying request makes `await res.json()` reject with `DOMException AbortError`.
- In `web/components/dashboard/HighlightsScrubber.tsx`, `res.json()` sits OUTSIDE the inner try/catch around `dedupedFetch`. The outer catch sees an AbortError while the cycle's own controller is NOT aborted, hits `if (err instanceof DOMException && err.name === 'AbortError') return;`, and exits with `data` still `null` (set at cycle start), so the panel renders "No highlights yet". "Check Status" calls `runFetchCycle`, which hits the identical path.
- The same defect affects the other consumer, `useHighlightsStatus` (find it with grep).

## 2. Contract & Implementation Directives

**Contract.** `dedupedFetch` aborts the shared network request ONLY while it is still pending (before headers). After the shared promise has resolved or rejected (`settled === true`), a detaching consumer never aborts, so every consumer that received a clone can always read its body in full. The rest of the semantics are unchanged: local aborts before settle still detach, the last pre-settle detach still cancels the request, and new callers still bypass settled entries.

Steps, IN ORDER:
1. `git fetch origin && git worktree add /home/kellyb_dev/projects/hex-yt-intel-hotfix -b fix/highlights-dedupe-body-abort origin/main && cd /home/kellyb_dev/projects/hex-yt-intel-hotfix && pnpm install --frozen-lockfile`
2. Write the failing test FIRST in `web/lib/__tests__/dedupe-fetch.test.ts`. Mock `fetch` so it resolves a `Response` whose body is a `ReadableStream` that enqueues its JSON only AFTER a delay and honours the fetch `signal` (error the stream on abort). Two consumers call `dedupedFetch` on the same URL, both await the response and then `await res.json()`. Assert both get the full JSON. Run it and paste the FAILURE (expect AbortError) before fixing.
3. Fix `detach()`: `if (currentEntry.consumers === 0 && !currentEntry.settled) currentEntry.controller.abort();`. Check that `settled` is set before the consumers' `.finally` runs (it is set in the inner async fn's `finally`, which completes before `currentEntry.promise` resolves — confirm that ordering in the test, don't assume it). Update the header comment's "Abort semantics" paragraph to say that aborts happen only pre-settle, and why.
4. Keep the existing tests green, especially the RCA 2026-09-27 settled-entry bypass test and the "last consumer detaches while in flight aborts the request" test (still true pre-settle).
5. Add a HighlightsScrubber-level regression test in `web/components/dashboard/__tests__/HighlightsScrubber.test.tsx`: with a delayed-body mock, the component renders highlights, not "No highlights yet".
6. NEGATIVE CONTROL: revert only the `&& !currentEntry.settled` guard and run both new tests. They must FAIL. Paste the output, then restore.
7. Gates (paste real output; all must exit 0):
```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
```
8. Commit ONLY the dedupe file + the two test files: `fix(highlights): never abort the shared request after headers — body was killed mid-stream` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push, then `gh pr create --base main --title "fix(highlights): dedupe aborted the response body (No highlights yet / dead Check Status)"` with the RCA + negative control + gates in the body, ending with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do NOT merge. STOP.

Hard rules: never touch the main checkout `/home/kellyb_dev/projects/hex-yt-intel` except appending to its `.memory/AGENT_LEDGER.md`. Do not touch `../hex-yt-intel-r1` (another OC run is working there).

## 3. Pre-PR Review Skills
- STEP 0: `build-graph`; `query_graph_tool` callers_of `dedupedFetch`. List every caller in the report (if a non-highlights caller exists, check it for the same bug).
- ALWAYS: `qa-intel` (both modes), `code-reviewer`, `review-delta`.
- `web/components/**`: `react-best-practices`.

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

Scoped checklist:
1. Contract = abort pre-settle only. Enforce it with the step 2 test.
2. E2E: server 200 with a slow body → dedupedFetch → both consumers → json() → setData → rendered highlights. Proven by the step 5 test.
3. Tangents: other `dedupedFetch` callers; `useHighlightsStatus` handling the same AbortError; any other code that aborts after `await fetch` but before reading the body.

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
