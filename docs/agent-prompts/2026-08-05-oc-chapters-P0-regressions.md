# OC Prompt — Chapters: 4 Confirmed P0 Regressions, 2026-08-05

## Why this prompt exists

PR #205 (`feat/chapters-and-speaker-id`) passed CI and two prior "verify10x"
passes (by CC) confirmed the 4 wiring points existed and were reachable in
isolation. A third-party automated review then found 4 P0-severity
regressions CC's own verification missed — CC independently re-verified
all 4 against the real code before writing this prompt (not re-trusting the
automated report at face value either). All 4 are confirmed real. Read
`docs/specs/CHAPTERS_AND_SPEAKER_ID_SPEC_2026-08-05.md` and
`docs/agent-prompts/2026-08-05-oc-chapters-wiring-CORRECTED.md` first for
the feature's existing design — this prompt assumes that context.

## The three tenets — mandatory, every item, no exceptions

1. **Contract definition + enforcement.** State the exact input→output
   contract for each fix BEFORE writing it. After writing it, check the
   diff against that stated contract — not "does it compile," but "does
   this actually fire on the real request path it claims to fix."
2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
   passing unit test proving a function's isolated output is correct is
   NOT sufficient evidence the fix works — trace the real caller chain
   (e.g. for P0-1, prove a CHUNKED analysis — not a synthetic non-chunked
   test — actually persists chapters).
3. **Tangent hunt as you walk the workflow.** While touching each file,
   check adjacent call sites and control-flow branches for the same class
   of gap. Report tangents found even if not fixed this pass.

**If you cannot complete a full cycle, or find a design gap mid-fix, STOP
and report the specific deviation and why, rather than shipping a partial
fix under a "done" label.** This exact feature has now had two "done"
reports rejected after independent verification — a third silently
incomplete report is not acceptable. A clearly flagged incomplete item is
fine; a silently incomplete one reported as done is not.

## P0-1 — Chunked analyses never persist chapters

**RCA (confirmed by CC via direct trace of `web/app/api/analyses/persist/route.ts`)**:
the chunk-completion/stitching branch (lines ~598–713) returns `{ type:
'chunk_saved' as const, analysisId, chunkIndex }` at line 713 — this return
fires for EVERY chunked request, including the one that stitches all
chunks together and finalizes the analysis. The chapter persistence call
(`await SupabaseTranscriptAdapter.upsertChapters(...)` at line ~900) sits
after this return, in a code path only non-chunked requests reach. Since
chunked streaming (`TOTAL_STREAMS`, up to 5 chunks) is the standard
production analysis flow, chapter persistence is dead in real usage.

**Contract**: chapters must be persisted exactly once per analysis, on
whichever request is the one that finalizes it — chunked or not. Verify:
does `rawChapters` arrive on every chunk request, or only some? (Each
worker stream request independently calls `parseChapters` per Gap 1 of the
prior wiring pass — confirm whether that's per-chunk or computed once and
forwarded.) Move (or duplicate, with idempotency) the chapter upsert call
into the finalization branch itself, before its `return` at line 713, so
it fires when the stitching/finalization actually happens.

**E2E proof required**: a real or realistically-mocked CHUNKED persist
sequence (multiple POSTs with `chunkIndex`/`totalChunks`) that ends with
`has_chapters: true` readable from `get_user_history_overview` for that
analysis. A test that only calls persist once with no `chunkIndex` does
NOT prove this fix — that's the path that already worked.

## P0-2 — Empty re-analysis doesn't clear stale real chapters

**RCA (confirmed by CC via direct read of `SupabaseTranscriptAdapter.upsertChapters`)**:
the `else if (attemptedButEmpty && videoId)` branch (chapters.length === 0
case) only upserts the `idx=-1` sentinel — it never deletes existing
`idx >= 0` rows from a prior analysis run. A video that previously had real
chapters, then gets re-analyzed and finds none, keeps showing green
(`has_chapters: true`) with stale seek boundaries from the old analysis.

**Contract**: chapter state must be replaced atomically on every
persistence call, not merged. When `attemptedButEmpty` is true: delete ALL
existing `idx >= 0` rows for the video before/as part of writing the
sentinel. When real chapters arrive: the existing stale-row cleanup (delete
`idx > chapters.length - 1`) already handles length-shrinking, but confirm
it also removes the sentinel (already done per the existing code) — no
change needed there, just confirm.

**E2E proof required**: a real test sequence — upsert real chapters for a
video, then upsert with `attemptedButEmpty: true` for the same video,
then call `getChapters` and confirm it returns `[]`, and confirm
`get_user_history_overview`-equivalent logic would now report `false`
(orange), not `true` (green), for that video.

## P0-3 — Purge/compliance functions never wired to the maintenance cron

**RCA (confirmed by CC via grep — zero call sites for
`purge_expired_chapters`/`compliance_check_chapters` anywhere in `web/` or
`worker/`)**: compare to the sibling `purge_expired_transcripts`, which
IS wired: `SupabaseTranscriptAdapter.purgeExpired()` calls it, and
`web/app/api/webhooks/transcript-purge/route.ts` is the real cron-triggered
endpoint that calls `purgeExpired()`. The chapters migration added the same
two functions (`purge_expired_chapters`, `compliance_check_chapters`) but
never added the equivalent call.

**Contract**: add `SupabaseTranscriptAdapter.purgeExpiredChapters()`
(mirroring `purgeExpired()`) and call it from the same
`transcript-purge/route.ts` cron endpoint alongside the existing transcript
purge call, so both run on the same schedule. Add a `complianceCheckChapters()`
method mirroring the existing `complianceCheck()` if that's also surfaced
somewhere (check where `complianceCheck()` — transcripts version — is
currently consumed, and mirror that, don't invent a new consumer).

**E2E proof required**: confirm the cron endpoint's actual code now calls
both purge functions (read the diff), and a test or direct
`execute_sql`-equivalent proof that an expired chapter row (real or
sentinel) is actually deleted when the endpoint runs.

## P0-4 — Chapter-first path ignores which entity was clicked

**RCA (confirmed by CC via direct read of `findEntityTimestamp`)**: the
chapter-priority branch (`web/lib/utils/entity-time-seek.ts` lines ~86–100)
does `dimensionContent.match(TIMESTAMP_RE)` — this finds the FIRST
timestamp anywhere in the entire dimension's prose, with no relationship to
`node.label` (the actual entity being clicked). The existing, correct
label-proximity logic (lines ~111–122: find `node.label` in the dimension
text, then find the nearest timestamp before it) only runs in the fallback
path AFTER the chapter branch, meaning it's bypassed whenever chapters
exist. Result: every entity in a dimension with chapter data resolves to
the same chapter (whichever contains the dimension's first timestamp),
regardless of which entity was actually clicked.

**Contract**: entity-relative timestamp selection must happen BEFORE
chapter lookup, not after. Refactor so the flow is: (1) find the
entity-relevant candidate timestamp using the EXISTING label/content/
keyTerms/proximity logic (unchanged, already correct), (2) THEN check if
that candidate timestamp falls inside a chapter range and use the
chapter's start as the anchor if so. This preserves the chapter-boundary
benefit (a more reliable anchor than a raw regex timestamp) while fixing
which timestamp gets chapter-mapped in the first place.

**E2E proof required**: a test with a dimension containing TWO distinct
timestamps, where only the SECOND one is adjacent to `node.label` — confirm
the function returns a timestamp/chapter derived from the second (entity-
relevant) one, not the first.

## Also flagged in the same review, worth a look but not blocking this pass

Report back (don't fix unless trivial) on: chapter range boundaries being
inclusive on both sides (double-boundary overlap risk at exact chapter
transitions), and whether `getChapters`/the RPC's `EXISTS` checks filter on
`expires_at > now()` (expired-but-not-yet-purged rows staying visible).
These are real P1s from the same review but the 4 P0s above are the
priority for this pass.

## Skills — enumerate live, not from memory

CORE: qa-intel (`pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare`
— use the EXACT CI-flag invocation, not the bare default run; the two
disagree on exit-code policy and CC already got burned by that mismatch
once this session), contract-auditor, `/simplify`.
SELECT: `supabase-postgres-best-practices` (P0-2/P0-3 touch delete/upsert
patterns and a migration-adjacent cron), `react-best-practices` if P0-4's
fix touches DashboardContainer.

## Report format (mandatory) — one row per P0, all four required

For EACH P0: RCA (confirm or refute CC's stated RCA above — don't just
restate it, verify it yourself) → Contract → Fix → E2E proof (cite actual
command/query output) → Tangents found → Deviations flagged (if any) →
Files changed. CC will independently re-verify every claim against real
code before accepting — a report claiming "done" without the E2E proof for
each P0 will be rejected and sent back, as happened twice already on this
feature.
