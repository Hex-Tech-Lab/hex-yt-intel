# OC Dispatch — fix PR #312 post-merge review findings (finalization race + malformed-payload handling)

Built from `docs/agent-prompts/TEMPLATE.md`. Model: OC (opencode, GLM 5.3 Flash, low effort).

## Ledger protocol (ALWAYS INCLUDE)
1. Read `.memory/AGENT_LEDGER.md` before touching any file — note the entries about PR #312 (merged `08c1f825`) which this dispatch builds on, and the concurrent `fix/chat-wordcloud-stream-resilience` dispatch which may ALSO be touching `web/app/api/analyses/persist/route.ts` — if you see file-overlap conflicts when you go to push, that's why; coordinate via the ledger, don't just force-push over it.
2. Append `[IN_PROGRESS] OC <timestamp> — dispatch-oc-pr312-review-findings: <intent>, target files`.
3. Flip to `[DONE]` with a one-line summary when finished. Do not merge yourself — CC is the sink orchestrator.

## Environment note
You cannot read or write ANY path outside this worktree directory. Any scratch file goes inside this worktree, delete before finishing.

## Step 0 (ALWAYS INCLUDE)
Use `code-review-graph` MCP tools before Grep/Read where available.

## Context (FILL IN)

PR #312 (merged `08c1f825`) fixed a real production bug: a payload-less chunk was falling through into a premature non-chunk finalize path, freezing analyses at a partial dimension count. A post-merge review (Cubic-style) of that merged PR found real follow-up correctness gaps in `web/app/api/analyses/persist/route.ts` and related files. This dispatch fixes them on a fresh branch off current main.

## Task — fix these, in priority order

### P0 — Parent finalization is not an atomic/idempotent `processing → terminal` transition
File: `web/app/api/analyses/persist/route.ts`. The finalize path (including the new `isFullySettled` path from #312) does not appear to guard the parent row's UPDATE with a `processing`-only precondition, and does not check whether that update actually applied before running downstream side effects (digest/highlights/validation dispatch, cache writes, QStash publishes). Two concurrent requests reaching finalize for the same analysis (a real scenario under retry) could both stitch, both write the parent, and both fire side effects — duplicate billing-adjacent work, a newer result overwritten by a stale one, or repeated mutation of an already-terminal row.
**Fix**: pass an explicit `guardBillingStatus: 'processing'` (or equivalent) into the atomic parent update, capture `{ updated: boolean }`, and if `updated === false`, return early — no cache writes, no billing transitions, no QStash publishes. This is the same CAS-guard shape already used elsewhere in this codebase (`analysis-reaper.ts`'s `tryRequeuePartial`, the `record_remediation_failure` RPC from PR #311) — reuse that pattern, don't invent a new one.
**Test**: two concurrent POSTs to the finalize path for the same analysis — assert exactly one parent update happens and exactly one set of side effects fires.

### P1a — Malformed *completed* chunks can be silently dropped during a settled-partial stitch
File: `web/app/api/analyses/persist/route.ts`. The `isFullySettled` path (#312) correctly exempts `failed`-status chunk indices from the stitch, but may also be exempting a chunk that's nominally `completed` in status yet has a malformed/unparseable payload — silently omitting real data loss without marking that chunk `failed` for observability.
**Fix**: validate every chunk claimed as `completed` even on the settled-partial path. A `completed` row that's actually malformed must either be reclassified to `failed` (with the same accounting PR #312 added for payload-less chunks) or cause the finalize to fail closed — never silently vanish from the stitch.
**Test**: one `failed` index + one nominally-`completed`-but-malformed index in the same set — assert the malformed one is NOT silently dropped (either reclassified or blocks finalize, pick the safer option and justify it).

### P1b — The payload-less-chunk fix only checks `!validPayload`; a malformed-but-truthy payload could still slip through
File: `web/app/api/analyses/persist/route.ts`. If a chunk's payload parses to a truthy object that lacks the required `dimensions` shape (e.g. `{}` or `{foo: 'bar'}`), the current discriminator may not catch it the same way `null`/`undefined` is caught, potentially re-opening the exact premature-finalize bug PR #312 fixed, just via a different malformed shape.
**Fix**: any request carrying a `chunkIndex` must always route through the chunk workflow (never fall through to non-chunk finalize), and payload validity must be classified as one of: valid / payload-less / malformed-object — with payload-less and malformed-object both persisting as a terminal `failed` chunk row, never silently falling through.
**Test**: `payload: null`, `payload: {}`, `payload: { foo: 'bar' }` — all three must persist as `failed` chunk rows, none must reach the non-chunk finalize path.

### P2a — `useAuxElementStatus`'s one-shot refetch guard is set before the fetch succeeds (StrictMode / failure double-bug)
File: `web/hooks/useAuxElementStatus.ts` (the hook PR #312 fixed for Channel Meta/Comments staleness). `fetchedForRef.current` appears to be set BEFORE the completion-fetch resolves, not after a successful response. Under React StrictMode's intentional double-invoke, or on a transient fetch failure, the guard can be consumed without ever completing a real fetch — permanently suppressing the one legitimate retry #312 was written to guarantee.
**Fix**: only mark the guard consumed after a successful fetch resolves; on cancellation or failure, leave it available for a legitimate retry (but still bounded — don't reintroduce an infinite retry loop; a single retry-on-next-relevant-event is enough, use judgment matching the original PR #312 intent).
**Test**: simulate StrictMode's double-effect-invoke (mount/unmount/remount) and a failed-then-succeeding fetch — assert the eventual successful fetch is not permanently blocked by either.

### P2b — Highlights validator's camelCase contract fields are optional, not enforced
File: `web/lib/validators/highlights.ts` (touched by PR #312 for the `verbatimExcerpt`/`takeawayIdx` snake→camel fix). The schema currently allows these fields to be entirely absent (`.optional()` + `.passthrough()`), which means a FUTURE regression back to snake_case would pass validation silently again — defeating the point of pinning the contract.
**Fix**: make both fields required-but-nullable (`z.string().nullable()`, `z.number().int().nullable()`) so their presence is enforced while `null` (legitimately no excerpt available) is still valid. Add a negative test proving a snake_case-only response object now FAILS validation.

## Gates (ALWAYS INCLUDE)
qa-intel (`pnpm qa-intel:ci` and `--mode diff --base origin/main`, exit code checked un-piped), full vitest suite for touched files, `tsc --noEmit`. Full skill stack per `feedback_mandatory_skill_stack_every_pr` (fresh `ls ~/.claude/skills .claude/skills` enumeration).

## Report format (ALWAYS INCLUDE)
For EACH item above: confirmed root cause, what was fixed, proof (test output, before/after where feasible). Note explicitly if `web/app/api/analyses/persist/route.ts` conflicts with the concurrently-running `fix/chat-wordcloud-stream-resilience` branch when you go to push — report the conflict to CC rather than force-resolving destructively. Post final `[DONE]` to ledger, hand back to CC — do not merge yourself.
