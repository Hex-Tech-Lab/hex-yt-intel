# Decoupling Chapter Persistence from the Analysis Request Lifecycle

**Status**: proposed, not implemented. Follow-up to the chapters feature
shipped in PR #205. Origin: user question during PR #205 review — "why are
[chapters and the analysis stream] coupled... why don't we fetch chapters on
their own... start with chapters, split them into a separate slot where they
land in their store gracefully, receive confirmation that they landed
successfully and move smoothly in parallel with the rest, and if they fail
they retry and we would already have the chapters so we don't need them
again." That's the right architecture; this doc scopes how to get there.

## Why today's coupling is an accident, not a requirement

Chapters have **zero dependency** on the LLM analysis or chunked streaming.
Confirmed by reading the actual code path:

- `worker/src/routes/analysis.ts:860`: `resolvedChapters = parseChapters(description)`.
  `description` comes from `req.metadata.description` (`worker/src/routes/analysis.ts:694`),
  which is already present in the request payload before any LLM call is
  made — it's the same `snippet.description` field `MetadataScraper.ts`
  fetches alongside the video title.
- Nothing about `parseChapters` reads streaming state, dimension output, or
  chunk index. It's a pure function of one string.

Yet the write path (as of PR #205, several iterations) is threaded through
`atomicPersist`'s `persist()` closure (`worker/src/routes/analysis.ts:753`,
`chapters: resolvedChapters ?? undefined`) → the same
`/api/analyses/persist` HTTP call used for the whole chunked LLM-analysis
result → a "safety-net" upsert that fires on every chunk request
specifically so partial/interrupted analyses don't lose chapter data
(`web/app/api/analyses/persist/route.ts`, see the PR #205 commit history).

That safety-net pattern is a real, working fix for the *symptom*
(chapters lost on interrupted analyses) but not the *cause* (chapters were
never independent in the first place). It's also inefficient: the same
chapters payload gets serialized into every one of up to 5 chunk POST
bodies and re-upserted up to 5 times per analysis, all to protect against a
failure mode that a decoupled path wouldn't have.

The **read** side is already decoupled, for context: `useChapters.ts`
polls its own `GET /api/analyses/[id]/chapters` endpoint independently of
the SSE analysis stream. The write side should match.

## Proposed architecture

### 1. Parse chapters once, at the earliest point `description` is known

`worker/src/services/MetadataScraper.ts` (or wherever the worker first
resolves video metadata, before `buildStreamResponse` is even called) is
the natural point — chapters don't need to wait for `buildStreamResponse`
to run at all. Call `parseChapters(description)` there.

### 2. Persist chapters through their own endpoint, not `/api/analyses/persist`

New route: `POST /api/videos/[videoId]/chapters` (or similar — naming TBD,
should live under a path that reflects "this is about the video, not a
specific analysis attempt," since chapters are keyed by `video_id` already,
not `analysis_id`).

- Request body: `{ chapters: ChapterInput[] }`, reusing the same
  tightened Zod schema from PR #205 (`idx >= 0`, finite nonnegative
  timestamps, nonblank label, `end_seconds > start_seconds` filter).
- Calls `SupabaseTranscriptAdapter.upsertChapters` (or directly the
  `write_real_chapters`/`write_chapter_sentinel` RPCs) exactly as today —
  none of that logic changes, only *when* and *from where* it's invoked.
- Auth: needs the same HMAC-signed-request pattern the worker already uses
  to call back into `/api/analyses/persist` (see `activeSecret`/`signingKey`
  threading in `analysis.ts`), scoped to `videoId` instead of `analysisId`.

### 3. Worker fires this immediately, in parallel with the LLM stream

The worker should call the new chapters endpoint as soon as chapters are
parsed (step 1), fire-and-forget relative to the LLM streaming work —
`c.executionCtx.waitUntil(...)` (the same pattern already used elsewhere in
`analysis.ts` for non-blocking background work), not awaited inline in the
critical path of `buildStreamResponse`.

This means: for a typical analysis, the chapters write can complete
*before* the first LLM chunk even finishes streaming — there's no reason
for the user to wait on dimension analysis to see accurate chapter data,
and no reason for chapter persistence to share fate with a slow or failed
LLM call.

### 4. Client-side: `useChapters` gets its own retry/backoff, decoupled from analysis `status`

Today's `useChapters.ts` gates its fetch-lock-in on `status === 'complete'`
(the *analysis's* status) as a proxy for "chapters have probably landed by
now." That's exactly the kind of coupling this doc argues against — once
writes are independent, reads shouldn't need to reason about analysis
status at all.

Proposed hook contract:
- Fetch chapters as soon as `videoId` (not `analysisId`) is known —
  independent of whether the analysis itself has started, is streaming, or
  has completed. Chapters may already exist from a *previous* analysis of
  the same video, or from this run's already-completed chapter parse.
- On an empty/failed result, retry with real bounded backoff (this doc's
  minimum bar: exponential backoff capped at N attempts over M seconds,
  not the current "poll forever if not complete, never retry if complete"
  logic) — since the write is no longer coupled to chunk completion, there's
  a well-defined "reasonable" window in which a fresh video's chapters
  should have landed (parse+write both fire near-instantly relative to the
  multi-second LLM stream), after which giving up and showing "no chapters"
  is the correct terminal state, not a permanent lock that requires a
  remount to escape.
- Once chapters are confirmed landed for a `videoId` (non-empty result, or
  a definitive "attempted, empty" sentinel response), cache them
  client-side keyed by `videoId` — a later analysis of the *same* video
  (re-analysis) doesn't need to re-fetch if the description hasn't
  changed, matching the user's "we would already have the chapters so we
  don't need them again" framing.

### 5. Migration path

This can ship incrementally without a flag day:
1. Add the new endpoint + worker call, alongside (not replacing) the
   existing safety-net write in `/api/analyses/persist`.
2. Verify the new path actually lands chapters correctly in production for
   a real analysis (E2E proof, not just unit tests — this feature has
   already had two rounds of "verified in isolation, broken end-to-end"
   findings in PR #205's review history; don't repeat that here).
3. Remove the safety-net write from `/api/analyses/persist` and the
   `rawChapters`/`chapters` field from the persist request schema
   entirely, once the new path is confirmed reliable.
4. Update `useChapters.ts` to the new fetch/retry/cache contract described
   above.

## Open questions for whoever picks this up

1. Exact route path and auth mechanism for the new worker→web callback —
   should it reuse the existing HMAC-signed-persist-token machinery
   (`signingKey`/`activeSecret` in `analysis.ts`) scoped down, or is a
   simpler service-to-service auth pattern more appropriate for a
   video-scoped (not analysis-scoped, not user-scoped) write?
2. Should the client-side `videoId`-keyed cache from step 4 live in a
   Zustand store (matching `useVideoStore`/`useAnalysisDimensionsStore`
   conventions elsewhere in this codebase) or stay a local hook cache? A
   store would let multiple components (history list, dashboard, chat)
   share one fetch instead of each mounting its own `useChapters` instance.
3. Does the "re-analysis of the same video" cache-reuse case need
   invalidation logic for when the video's description genuinely changed
   (creator edited it) between analyses? Low priority — descriptions
   rarely change after publish — but worth a one-line decision either way
   rather than leaving it implicit.

## Non-goals

- This doc does not propose changing the DB schema (`transcript_chapters`,
  the sentinel convention, the CHECK constraint, TTL/purge) — all of PR
  #205's persistence-layer work stays as-is, only *who calls it and when*
  changes.
- Not proposing to decouple the *speaker ID* feature (still deferred per
  the original chapters+speaker-id spec) — this doc is chapters-only.
