# Task Batch: Finish Logs Console Gaps + Correct Task 4 RCA

Dispatched to AGY 2026-07-28, follow-up to `d5602b37` (which shipped Task 1-4 of the
prior batch, `docs/history/prompts/2026-07-28-agy-logs-observability-tooltip-stream4.md`).

## Task 1 — Fix the QStash route, it's throwing in production right now

Verified via Sentry (`hex-org/hex-yt-intel`, event at `2026-07-28T15:29:43Z`):

```
Error: Upstash QStash API returned 400: {"error":"unknown query parameter: startTime"}
  at GET /api/admin/logs/qstash
```

`web/app/api/admin/logs/qstash/route.ts` is sending a `startTime` query param the
QStash REST API doesn't accept. Check QStash's actual events/logs endpoint docs for the
correct param name (likely `fromDate`/`cursor`-based, not `startTime` — verify against
the real API, don't guess a second time) and fix it. **Proof required**: a real
successful response from the fixed endpoint, not just "should work now."

## Task 2 — Add the missing Upstash Vector tab

The prior batch's report claimed "3 new tabs for Upstash (Redis, QStash, Vector)" but
only `upstash-redis` and `qstash` routes/tabs exist — confirmed via `git show d5602b37
--stat` (no `upstash-vector` file) and by counting `key:` entries in
`LogsViewerClient.tsx` (7 tabs, not 8). Either:
- Build it for real (`web/app/api/admin/logs/upstash-vector/route.ts` + tab), following
  the pattern of the other two Upstash routes, using whatever Vector REST credentials
  exist — check `UPSTASH_VECTOR_REST_URL`/`UPSTASH_VECTOR_REST_TOKEN` in worker secrets
  first; or
- If no Vector index is actually provisioned for this project, say so explicitly in your
  report and don't build a tab for something that doesn't exist — that's an acceptable
  outcome, silently omitting it without saying which case it was is not.

## Task 3 — Correction: Task 4's RCA evidence was fabricated, do not treat it as settled

The previous report claimed a "live worker tail log" showing `finish_reason: "length"`
for stream `stream-1785243700238-4iamp4q` (encodes `2026-07-28 13:01:40 UTC`). This was
checked and does not hold up:

1. `finish_reason` is never read from the OpenRouter response anywhere in
   `worker/src/services/LLMCascade.ts` — grep confirms zero matches. There is no code
   path that could have produced that value.
2. `wrangler tail` is realtime-only and cannot retrieve an event from hours earlier.
3. Sentry (wired, confirmed working, `hex-org/hex-yt-intel`) has no event at that
   timestamp or matching that JSON-parse position. It does have a real, different event:
   `SyntaxError ... at position 2967` at `2026-07-28T11:36:21Z`, which matches the
   *first* failed attempt (analysis `77655627`, created `11:35:08`), not the one AGY
   cited (`c8fdd013`, the 13:01-13:03 retry).

**The actual "why now" root cause, found via git history + live settings, not
guesswork**: `worker/src/services/LLMCascade.ts` had `maxOutputTokens.haiku` bumped to
62000 on 2026-06-13 (`e18b82f5`), which caused a full production outage on
2026-07-25 21:12 (OpenRouter 402: "requested up to 62000 tokens, but can only afford
6583" — 5 parallel streams × 62000 tokens each trips OpenRouter's per-request
affordability check even at a healthy balance) and was emergency-reverted to 8192 same
day (`f1e5e0cf`), then moved into the settings registry (`685dab8d`). Confirmed still
live: `setting_values` has `analysis.maxOutputTokens.haiku = 8192`, updated
`2026-07-25 18:27:35`. The truncation risk has existed since that revert — it just
hadn't been hit by a heavy-enough dimension combination in one stream until `[5,7,10]`
did on 2026-07-28.

**Do not raise `maxOutputTokens.haiku` back up as a fix** — the 402 shows OpenRouter's
affordable ceiling is dynamic (tied to live account balance/concurrent load), so a flat
bump risks reproducing the 2026-07-25 outage. The user has explicitly signed off on the
`STREAM_BUNDLES` rebalance already shipped (`[1,10]`/`[8]`/`[2,4,6]`/`[5,7]`/`[3,9,11]`)
as the right lever and does not want a 6th stream added preemptively — only if this
recurs after the rebalance has had a chance to prove itself.

**What to actually do for this task**: nothing code-wise — the rebalance already landed
and is the agreed fix. Your job here is just to internalize why the previous evidence
was wrong, so the same fabrication pattern doesn't repeat. If you want to *make this
verifiable going forward*, that's covered by Task 4 below.

## Task 4 — Capture `finish_reason` for real, going forward

Since this exact ambiguity (was it token truncation or something else?) will recur for
any future JSON-parse failure, add `finish_reason` capture to the cascade so it's never
guessed at again:

1. In `worker/src/services/LLMCascade.ts`, read `finish_reason` off the OpenRouter
   streaming response (same place `chat-stream.ts` was just taught to capture
   `servedByProvider` — mirror that pattern) and include it in the
   `Sentry.captureException` context in `worker/src/services/MarkdownReconstructor.ts`
   (`extractJsonPayload`'s existing `contexts: { extractJsonPayload: { ... } }` block,
   currently only has `finalTextLength`/`textLength`, add `finishReason` alongside it).
2. Proof required: trigger or wait for a real JSON-parse failure and show the resulting
   Sentry event actually has `finishReason` in its context — not a code-reads-fine
   claim.

## Non-negotiable process requirements (same as last batch, repeating because Task 3 above is exactly why)

1. Every "confirmed" claim needs an attached, checkable artifact — an actual pasted API
   response, an actual Sentry event ID/link, an actual log line. A plausible-sounding
   narrative is not evidence.
2. If you cannot independently retrieve the evidence a claim needs (e.g., historical
   worker logs before this session's observability fix existed), say that plainly
   instead of presenting inferred/constructed detail as a direct observation.
3. Proof required per task as specified above.
