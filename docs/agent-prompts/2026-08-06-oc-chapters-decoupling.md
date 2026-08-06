# OC Prompt — Chapters Decoupling Implementation, 2026-08-06

Branch: `feat/chapters-decoupling` (already created off `main`, pushed,
contains only the approved design doc so far —
`docs/specs/CHAPTERS_DECOUPLING_DESIGN_2026-08-06.md`. Read it in full
first; this prompt implements it, don't re-derive the design). PR #205
(the chapters feature this decouples) is already merged to `main`.

## Why this exists

Chapters (`transcript_chapters`) currently get parsed and persisted as a
side effect of the chunked LLM-analysis request lifecycle — a "safety-net"
write that fires on every chunk POST specifically so partial/interrupted
analyses don't lose chapter data. That's a correct fix for a real symptom,
but chapters have **zero actual dependency** on the LLM/streaming/chunking
— they're a pure function of `req.metadata.description`, available before
any LLM call starts. The design doc scopes decoupling this properly:
independent parse+persist path, fired in parallel with the LLM stream,
independent client-side fetch/retry/cache.

## The three tenets — mandatory, every step, no exceptions

1. **Contract definition + enforcement.** State the exact input→output
   contract for each new piece (route signature, auth token shape, store
   API) before writing it. Check the diff against that contract before
   reporting anything done.
2. **E2E cycle complete, input to output, across the ENTIRE chain.** This
   feature has already had TWO rounds of "verified in isolation, broken
   end-to-end" findings during PR #205's review (chapters never called at
   all, then only fired on the wrong branch, then found real DB rows
   deleted by a malformed-input edge case) — all caught by independent
   verification, not by the implementing agent's own unit tests. Do not
   repeat that pattern. A passing unit test on the new route handler is
   NOT sufficient evidence — trace the real worker→endpoint→DB→client
   chain with actual proof (live DB query showing a row landed, actual
   HTTP round-trip, not a mock standing in for the whole chain).
3. **Tangent hunt.** While touching each file, check adjacent code for the
   same class of gap. Report tangents even if not fixed this pass.

**If you find a design gap or can't complete a full cycle, STOP and flag
the specific deviation rather than shipping a partial fix under a "done"
label.** A clearly flagged incomplete item is fine; a silently incomplete
one reported as done is not — this is the standing rule for this feature
after real incidents, not boilerplate.

## Scope — implement per the design doc's approved decisions

### 1. New endpoint: worker → web chapters callback

- Route: `POST /api/videos/[videoId]/chapters` (confirm this exact path
  doesn't collide with existing routing conventions before committing to
  it — check `web/app/api/` structure first).
- Request body: `{ chapters: ChapterInput[] }` — reuse the EXACT tightened
  Zod schema from PR #205's `web/app/api/analyses/persist/route.ts`
  (`idx: z.number().int().min(0)`, finite nonnegative timestamps, nonblank
  label) plus the manual `end_seconds > start_seconds` post-parse filter
  pattern (not `z.refine()` — that pattern hit a real qa-intel
  `SchemaContractRule` blind spot last time, documented in
  `docs/qa-intel/RULESET_LESSONS_LEDGER.md`, don't reintroduce it).
- Auth: **reuse the existing HMAC-signed-request machinery** (approved
  design decision, not a new bespoke pattern) — find the exact mechanism
  `analysis.ts`'s `signingKey`/`activeSecret` and the persist route's
  signature verification use today (grep for `verifyContentSig` or
  equivalent), and scope a token to `{videoId, exp}` instead of
  `{analysisId, exp}`. Same trust boundary, narrower scope.
- Handler calls `SupabaseTranscriptAdapter.upsertChapters` exactly as
  today (`write_real_chapters`/`write_chapter_sentinel` RPCs, already
  correct and live-verified from PR #205 — do not modify that logic, only
  change who calls it and when).

### 2. Worker: parse once, fire in parallel, not inline in the LLM path

- Move `parseChapters(description)` to fire at the earliest point
  `description` is known (`worker/src/services/MetadataScraper.ts` or
  wherever metadata resolution happens, BEFORE `buildStreamResponse` is
  called — confirm the exact current call site via
  `worker/src/routes/analysis.ts:860` first, don't guess).
- Call the new endpoint via `c.executionCtx.waitUntil(...)` (same
  non-blocking pattern already used elsewhere in `analysis.ts` — find and
  match it, don't invent a different async pattern) — fire-and-forget
  relative to the LLM streaming work, not awaited inline.

### 3. Remove the old safety-net write — but only after step 1+2 are E2E-proven

- Per the design doc's migration path: do NOT rip out the existing
  `/api/analyses/persist` chapters handling in the same pass as adding the
  new path. First prove the new path works end-to-end in this branch
  (real E2E proof per tenet 2), THEN remove `rawChapters`/`chapters` from
  the persist route's Zod schema and the safety-net upsert call in
  `web/app/api/analyses/persist/route.ts`, and the corresponding
  `chapters` field threading in `worker/src/routes/analysis.ts`'s
  `atomicPersist` closure.
- If you're not fully confident the new path is proven by the time you'd
  otherwise remove the old one, LEAVE THE OLD ONE IN (both paths writing
  is harmless — the RPC is idempotent) and flag that as a deviation rather
  than removing safety-net coverage you haven't actually replaced yet.

### 4. Client: `useChaptersStore` (Zustand), replacing the hook's own cache

- New store, `web/store/useChaptersStore.ts` (match this repo's existing
  store file location/naming convention — check `useVideoStore`/
  `useAnalysisDimensionsStore`'s actual file paths first, don't assume).
- Shape: keyed by `videoId`, each entry
  `{status: 'idle'|'loading'|'loaded'|'error', chapters, fetchedAt}`.
- Fetch is triggered by `videoId` being known — independent of analysis
  `status` entirely (no more gating fetch-lock-in on `status === 'complete'`,
  per the design doc's explicit critique of that coupling).
- Bounded retry/backoff on empty/failed results (design doc's minimum bar:
  exponential backoff capped at N attempts over M seconds — pick concrete
  numbers appropriate to how fast the new parse+write path actually
  completes relative to the old chunk-gated one, state your reasoning for
  the numbers chosen, don't hardcode without justification per this
  project's own no-hardcoded-magic-numbers standing rule).
- `useChapters(videoId)` becomes a thin selector over the store, not its
  own fetch-and-cache logic — update all real call sites (grep for
  `useChapters(` across `web/`, don't assume you know all of them).
- Add the one-line comment the design doc specifies on the store: cache
  invalidates via re-fetch after re-analysis persists (the re-parse +
  idempotent RPC write IS the invalidation mechanism), not via any
  description-diffing — state this as a deliberate decision, not leave it
  implicit.

## E2E verification required (not optional)

Walk the full chain with real evidence at each hop, for at least one real
or realistically-constructed video:
1. Confirm the worker actually calls the new endpoint (not just that the
   function exists — a real invocation, logged or directly observed).
2. Confirm a real row lands in `transcript_chapters` via the new path
   specifically (not the old safety-net path — if both are still active
   during transition, prove which one actually wrote the row, e.g. by
   temporarily disabling the old path in a test run, or timing).
3. Confirm the client store actually receives and caches the chapters
   independent of analysis status (e.g. fetch chapters BEFORE the analysis
   reaches 'complete', confirm they're already available).
4. Confirm the chip/entity-seek UI still works correctly end-to-end with
   the new data path (this was the whole point of PR #205 — don't
   regress it while decoupling the plumbing underneath).

## Skills — enumerate live, not from memory

CORE: qa-intel (`pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare`
— the EXACT CI flags, the bare default run has different exit-code
behavior and will give you a false pass), contract-auditor
(`pnpm tsx web/scripts/contract-auditor.ts`), `/simplify`.
SELECT (checked fresh against `.claude/skills/pr-review-workflow`'s live
trigger list, not from memory): new route/auth path →
`owasp-top-10`. New Zustand store + hook refactor →
`react-best-practices`. Any Supabase/RLS touch on the new route →
`supabase-postgres-best-practices` + `supabase`.

## Process — full /pr-review-workflow from the start (per explicit user instruction)

This is NOT a quick patch — run the full workflow, not an abbreviated
version:
- **Phase 0**: you're already on `feat/chapters-decoupling`, no existing
  PR yet — create one once there's real work to review, don't wait until
  everything is "finished."
- **Phase 1**: local isolation + AST pulse — tsc, the CORE+SELECT skill
  stack above, Hex-Lite boundary check (Supabase access stays in
  `adapters/`).
- **Phase 2**: open the PR, let the full external tool stack run (Cubic,
  CodeRabbit, Snyk, DeepSource, CodeQL, CI/CD) — don't just self-report
  clean and stop.
- **Phase 3**: sequential resolution of real findings (same standard as
  PR #205's review cycle: verify each against current code before fixing,
  skip false positives with a stated reason, live-verify DB-level claims
  via rolled-back transactions where applicable).
- **Phase 5**: confidence-score sign-off before considering this
  merge-ready — CC (Claude Code) does the final independent verification
  pass and owns the merge decision, same as every prior round on this
  feature. Do not merge this yourself.

## Report format (mandatory)

RCA → Contract → Fix → E2E proof (cite actual command/query output, not
"tests pass") → Tangents found → Deviations flagged (if any, especially if
step 3's safety-net removal was deferred) → Skills run + findings → Gates
→ Files changed. CC will independently re-verify every claim against real
code and real DB state before accepting — this has been necessary on every
single round of this feature so far, expect the same standard here.
