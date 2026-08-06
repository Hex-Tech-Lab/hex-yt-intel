# OC Prompt — PR #206 Remaining Review Findings

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — read it now if
you haven't already. Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md`
before touching any file; post `[IN_PROGRESS]` with intent + target files as
your first action; re-check the ledger after every subtask; post
`[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually
happened (not what you intended) as your last action.

## 1. Context

Branch `feat/chapters-decoupling`, PR #206 (https://github.com/Hex-Tech-Lab/hex-yt-intel/pull/206),
currently at commit `4dbb88cb`. This decouples chapter persistence
(YouTube-description → parsed chapters → DB → UI) from the chunked-analysis
request lifecycle. CC has already independently found and fixed 3 real
regressions in this branch (malformed-chapters-wipes-real-data bug,
confirmed/unconfirmed race in the read path, and a P0 self-cancelling React
effect that made the whole feature non-functional — see
`docs/history/HANDOVER_2026-08-06_CHAPTERS_FEATURE_AND_DECOUPLING.md` for
full detail on all of the above, read it first). This prompt covers what's
STILL open after those fixes — a combined Cubic + Qodo review pass.

**This feature's track record**: every "done" report on this branch so far
has been clean on unit gates while broken on the real end-to-end chain (see
the handover's "Recurring Patterns" section — this is now a NAMED, tracked
pattern, not a one-off). Treat that as the default expectation, not an
exception.

## 2. Task

Fix the following, each verified independently against current code before
touching anything (some review claims may already be stale/fixed — check
first):

1. **Worker doesn't POST for a present-but-empty description.** `worker/src/routes/analysis.ts`'s
   new chapters block is guarded by `if (description)` — a present-but-empty
   string is falsy-ish in some checks but here `if (description)` on an empty
   string `''` IS falsy in JS, so an empty (not missing) description also
   skips the POST entirely. This means the confirmed-empty sentinel can never
   be written for a video whose description IS present but empty (as opposed
   to a video with no description field at all, or a video whose description
   genuinely has no chapter markers — that case DOES POST, with `chapters:
   []`, per the existing code). Distinguish "no description field at all" (skip,
   nothing to parse) from "description present, parses to zero chapters"
   (must still POST so the sentinel gets written).
2. **`waitUntil` fetch ignores non-2xx and has no timeout.** The fire-and-forget
   POST call in `worker/src/routes/analysis.ts` only catches transport-level
   exceptions (network failure) — a 400/401/500 response from the endpoint is
   treated as a successful call with no logging, and there's no timeout, so a
   hung request can consume the background task indefinitely with zero
   diagnostics. Add: check `response.ok`, log/Sentry-capture status + a
   bounded snippet of the response body on non-2xx, and an `AbortController`
   timeout (pick a concrete value with stated reasoning — this project's own
   no-hardcoded-magic-numbers rule applies; the request is a small JSON POST
   to the same-origin web app, reason about what's actually reasonable, don't
   copy a number from elsewhere without justification).
3. **No re-analysis cache-invalidation call site.** `useChaptersStore` already
   has a `reset(videoId)` method, but nothing calls it. Re-analyzing the same
   video can produce new/different chapters (if the description changed or a
   prior attempt was malformed/empty), but the client-side cache has no
   signal to refresh — it'll keep serving the old cached entry indefinitely
   once `status === 'loaded'` or `'error'`. Find where a new analysis run
   starts client-side (search for where `status` transitions to
   `'analyzing'`/`'downloading'` in `DashboardContainer.tsx` or wherever
   analysis lifecycle state lives) and call `useChaptersStore.getState().reset(videoId)`
   at that point.
4. **Public GET endpoint's privacy assumption.** `web/app/api/videos/[videoId]/chapters/route.ts`'s
   GET handler has no auth, on the stated assumption that a bare `videoId` is
   not sensitive. Audit this against how OTHER per-video data in this
   codebase is exposed (check whether `videoId`-only lookups are used
   elsewhere without auth, e.g. thumbnail/metadata endpoints, as precedent) —
   if there's no such precedent, or if unlisted/private YouTube videos could
   have their existence/chapter-structure enumerated via this endpoint by an
   unauthenticated caller who guesses/scrapes video IDs, that's a real
   decision to flag, not silently accept. State your finding either way
   (matches existing precedent → fine as-is with a citation; doesn't →
   flag as a P1 needing a real auth decision from the user, don't unilaterally
   add auth without confirming what the right model is).
5. **Qodo's "chapters retries never stop" and "waitUntil POST ignores
   non-2xx".** Cross-check the retries-never-stop finding against CC's
   already-landed fix (`web/hooks/useChapters.ts`, commit `782d2b17`) — this
   is very likely the SAME bug already fixed (self-cancellation → infinite
   retry after exhaustion), but CONFIRM by re-reading the current file
   yourself, don't assume. The non-2xx finding is the same as item 2 above,
   don't duplicate the fix.
6. **Qodo's 2 rule violations**: mixed type/value import and import-grouping
   issues on `web/app/api/videos/[videoId]/chapters/route.ts`. Quick, low-risk
   — fix if genuinely still present (re-check current file).
7. **3 failing style/static-analysis checks** (CodeFactor, DeepSource web,
   DeepSource worker) on the live PR. Check `gh pr checks 206` for current
   state — every prior round on this feature had these same 3 checks come
   back as pre-existing complexity/style noise with no branch protection and
   no weight in this project's confidence formula (see
   `CLAUDE.md` §6 PR Confidence Calculator). Verify this round's specific
   findings are the same class before dismissing — don't assume just because
   it's been true every time before.

## 3. Goal / definition of done

All 7 items above resolved (fixed, or explicitly determined to already be
fixed/not-applicable with cited evidence) with real E2E proof for the
functional ones (1–4), not just clean unit gates. PR #206 in a state where
CC's next verification pass can plausibly conclude "actually merge-ready" —
which has not yet happened once on this branch.

## 4. Expected results

- Worker correctly distinguishes "no description" from "empty description"
  and POSTs in the latter case.
- The `waitUntil` fetch call has explicit status-check + timeout + logging.
- A `reset(videoId)` call site exists at the correct re-analysis-start point.
- A stated, evidenced decision on the GET endpoint's auth posture.
- Qodo's findings cross-checked, duplicates not re-fixed, genuine gaps closed.
- CI checks re-verified against current state, not assumed from history.

## 5. Task-specific skills/tools/plugins/MCPs

CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets are
[ALWAYS INCLUDE] below, not repeated here. Beyond that: `owasp-top-10`
applies directly to item 4 (auth/access-control decision on a new API
endpoint). `react-best-practices` applies to item 3 (React state lifecycle/
cache invalidation timing). Supabase MCP (`execute_sql` wrapped in
`BEGIN...ROLLBACK`) if item 4's investigation needs to check how other
tables/endpoints in this project handle similar video-scoped access — this
project's established pattern is live-DB verification over assumption.

## 6. Fixtures — [ALWAYS INCLUDE, then task-specific]

Run `code-review-graph`'s `build_or_update_graph_tool` then
`get_review_context_tool`/`get_impact_radius_tool` scoped to
`worker/src/routes/analysis.ts`, `web/hooks/useChapters.ts`,
`web/store/useChaptersStore.ts`, `web/app/api/videos/[videoId]/chapters/route.ts`,
and `web/components/containers/DashboardContainer.tsx` before reading full
files. Start from `feat/chapters-decoupling` at commit `4dbb88cb` (verify
you're actually on this commit — `git log --oneline -1` — before assuming
prior fixes are present).

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the exact input→output
   contract for each fix before writing it. Check the diff against that
   contract before reporting done.
2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
   passing unit test is NOT sufficient evidence. For items 1–2 (worker-side),
   trace the real path: does a real fetch/POST actually get made with the
   right body, does the server actually receive and process it correctly. For
   item 3, trace: does a real re-analysis actually clear the cached entry.
3. **Tangent hunt.** While in each file, check for the same class of gap
   nearby. Report tangents even if not fixed this pass.

**If you cannot complete a full cycle or find a design gap, STOP and flag
the specific deviation.** This feature's history has multiple confirmed
incidents of silently-incomplete work reported as done — do not add another.

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (actual command/query output) → Tangents
found → Deviations flagged → Skills run + findings → Gates → Files changed.
CC independently re-verifies every claim against real code and real system
state before accepting.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' — empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # EXACT CI flags, not the bare default run
pnpm tsx web/scripts/contract-auditor.ts
```
