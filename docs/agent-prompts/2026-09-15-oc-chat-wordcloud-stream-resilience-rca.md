# OC Dispatch — RCA + fix: chat not responding, WordCloud missing/500, recurring chip gaps, stream resilience under connection drop

Built from `docs/agent-prompts/TEMPLATE.md`. Model: OC (opencode, GLM 5.3 Flash, low effort) — investigation AND execution, per user's explicit context-window-budget directive.

## Ledger protocol (ALWAYS INCLUDE)
1. Read `.memory/AGENT_LEDGER.md` before touching any file — note the immediately preceding entries about PR #312 (merged just before this dispatch, fixes a related but distinct chip-staleness bug in `useAuxElementStatus` for Channel Meta/Comments only, NOT WordCloud or Chapters).
2. Append `[IN_PROGRESS] OC <timestamp> — dispatch-oc-chat-wordcloud-resilience-rca: <intent>, target files`.
3. Flip to `[DONE]` with a one-line summary when finished. Do not merge yourself — CC is the sink orchestrator.

## Environment note
You cannot read or write ANY path outside this worktree directory — not `/tmp`, not `~/.wrangler`, not the main checkout, not `docs/private/`. Any scratch file goes inside this worktree, delete before finishing. Use Supabase/Sentry MCP tools if configured in your env; if not, state clearly what CC needs to pull instead of guessing.

## Step 0 (ALWAYS INCLUDE)
Use `code-review-graph` MCP tools before Grep/Read where available.

## Context (FILL IN) — user-reported incident, real production video, with real evidence already gathered by CC

Video: `https://www.youtube.com/watch?v=rDhaCLrdWHk`. Incident window: **2026-09-14, ~09:00-10:40 UTC (12:00-13:40 EEST)**, during a real internet disruption the user experienced. Four symptoms:

1. **Chat not working**: user typed a message, sent it, it disappeared with no response and no error shown.
2. **WordCloud not created** on first load for this video. After the internet disruption resolved, the page auto-reloaded on its own, and the WordCloud then opened fully populated without further action.
3. **Status chips incomplete**: screenshot (user-provided, not reproducible here) showed `Channel Meta` and `Comments` gray while `Digest`/`Description`/`Chapters`/`Highlights (10)` were green, with "100% complete" footer — user says it started with **3 chips missing**, and after a page refresh (post-disruption) `Chapters` appeared (down to 2, then to 1 in the final screenshot). User is confident this video genuinely has chapters and was surprised they weren't there on the first render.
4. **500 Internal Server Error** when the user clicked to open the WordCloud control, during the same internet disruption. User's own hypothesis: connection drop caused it, but explicitly flags that **the system should be resilient to a dropped connection regardless** — a 500 on a transient network blip is itself the bug worth fixing, not just explaining away.

### Evidence CC already gathered — build on this, don't re-derive

- **PR #312** (merged just before this dispatch, commit `08c1f825`) fixed a *related but distinct* bug: `useAuxElementStatus`'s in-memory payload guard was permanently blocking a post-completion refetch for `Channel Meta`/`Comments` specifically. It did **not** touch `Chapters` or `WordCloud` — if those share a similar stale-payload/refetch-guard root cause, it's a **separate but architecturally similar** bug, not something #312 already fixed. Confirm whether `Chapters`' and `WordCloud`'s own completion-detection code has the same "compute once, never refetch" shape `useAuxElementStatus` had before #312, and fix it the same way if so — don't invent a new pattern if the existing fixed one already applies.
- **Sentry issue `HEX-YT-INTEL-3E`** (`https://hex-org.sentry.io/issues/136365595`, org `hex-org`, region `https://de.sentry.io`): `SyntaxError: Expected ',' or '}' after property value in JSON at position 6603` in `POST /analyze-llm-stream` (the Cloudflare Worker), occurred at `2026-09-14T09:13:38.993Z` — squarely inside the incident window. Stack: `extractJsonPayload` → `safeParse` → `JSON.parse` fails, tagged `finishReason: "stop"`, `phase: "initial_parse"`, `textLength: 11268`, `handled: yes` (already caught by a try/catch somewhere). **Recurring**: first seen 2026-07-24, 18 occurrences total, not a one-off. This may or may not be the direct cause of symptom 4 (it's in the main analysis stream endpoint, not obviously the WordCloud-specific endpoint) — confirm or rule out explicitly, and separately: this recurring parse failure is worth fixing regardless of whether it's symptom 4's direct cause, since it's silently losing data 18 times over 2 months.
- The multi-provider log snapshot tool is `scripts/poll-logs-snapshot.sh [range] [base_url]` → hits `/api/admin/logs/snapshot` (HMAC-authed, secret in `web/.env.local`). **Known gap CC found**: this route only wires 7 of the fetchers defined in `web/lib/admin-logs/fetchers.ts` — `fetchSentryLogs`, `fetchOpenRouterLogs`, and `fetchContractAuditLogs` exist but are NOT called by `web/app/api/admin/logs/snapshot/route.ts`. Confirm this gap and, if it's a quick/safe addition (matching the existing `Promise.all` fan-out pattern exactly), wire them in as part of this fix — the user explicitly relies on this script to pull "all the logs" for incident investigation and it's currently missing 3 real sources.

## Task

### Investigation order

1. **Chat (symptom 1)**: find the chat send path (likely `web/components/.../ChatDock.tsx` or similar + its API route). Reproduce or trace what happens when a message is sent and the request never resolves or fails silently — is there a missing error boundary, a swallowed fetch rejection, or a race where the UI clears the input optimistically but never re-renders on failure? Check ownership/grounding logic too (ADR 008/009) — could a rejected/refused response be rendered as nothing rather than a visible refusal message?

2. **WordCloud (symptoms 2 + 4)**: find the WordCloud component and its data-fetch/completion-check logic. (a) For the missing-on-first-load issue: check if it shares the stale-payload-guard pattern `useAuxElementStatus` had before #312 (see above). (b) For the 500: find the actual endpoint/control WordCloud's "open" action calls, and determine what specifically throws a 500 — is it the same `extractJsonPayload`/JSON.parse fragility from `HEX-YT-INTEL-3E`, a separate WordCloud-specific data-fetch failure, or something else entirely (e.g. an unhandled rejection when the underlying analysis payload is itself incomplete because of symptom 2). Whatever the real cause, the fix should make a transient failure (network drop, malformed partial data) degrade gracefully — a clear retry/error state, not a raw 500 — consistent with the user's explicit resilience ask.

3. **Status chips / Chapters (symptom 3)**: find Chapters' own completion-status logic (likely near `useChapters` per prior ADR 022 history, or wherever chapter data is checked/rendered) and determine whether it has the same "computed once from a live in-memory stub that never refetches" bug class #312 just fixed for Channel Meta/Comments. Confirm this video's chapters were actually generated and persisted (query Supabase `transcripts`/`analyses` for `rDhaCLrdWHk` — check for a `chapters`/`transcript_chapters`-shaped field, per `add_transcript_chapters`/`write_chapter_sentinel_atomic` migrations) at the time the chip was gray, to confirm this is a display/refetch bug and not a real backend delay.

4. **Recurring JSON parse failure (`HEX-YT-INTEL-3E`)**: read the worker's `extractJsonPayload`/`safeParse` code (search for those exact names in `worker/src/`). Determine why a `finishReason: "stop"` (LLM believes it completed normally) response can still fail `JSON.parse` — likely a malformed/truncated bracket structure the `BracketBuffer` repair-and-reparse (ADR 021, `worker/src/__tests__/bracket-buffer-emission-boundary.test.ts`) doesn't fully handle for this specific failure shape. Fix the parse resilience if a clear, safe fix is identifiable (e.g. the same best-effort repair extended to cover this exact malformation), or at minimum ensure the caught error results in a clean partial/failed state with real telemetry rather than a silent swallow (check what happens downstream of this `handled: yes` catch today).

5. **Admin logs snapshot route gap**: wire `fetchSentryLogs`, `fetchOpenRouterLogs`, `fetchContractAuditLogs` into `web/app/api/admin/logs/snapshot/route.ts`'s existing `Promise.all` fan-out, matching the response-shape pattern of the other 7 fetchers exactly. This is a small, mechanical, low-risk addition — do it as part of this PR unless something about it turns out to be non-trivial (report why, don't force it).

## Gates (ALWAYS INCLUDE)
qa-intel (`pnpm qa-intel:ci` and `--mode diff --base origin/main`, exit code checked un-piped), full vitest suite for touched files, `tsc --noEmit`. Full skill stack per `feedback_mandatory_skill_stack_every_pr` (fresh `ls ~/.claude/skills .claude/skills` enumeration).

## Report format (ALWAYS INCLUDE)
For EACH of the 4 user-reported symptoms plus the log-snapshot gap: confirmed root cause (or "not fully confirmed, here's what's known and what's still open"), what was fixed, proof. Post final `[DONE]` to ledger, hand back to CC — do not merge yourself.
