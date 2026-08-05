# OC Prompt — Chapters: Actually Wire It End-to-End (CORRECTED), 2026-08-05

## Why this prompt exists

Two prior agent passes (OC, then AGY on the chip) each reported "done."
Both were false. CC independently traced the real data flow YouTube →
worker → DB → client → UI and found FOUR separate missing connections —
every individual unit (parser, migration, `findEntityTimestamp`, chip) is
internally correct and passes its own tests in isolation, but as a
feature, NOTHING IS WIRED TOGETHER. tsc/vitest/qa-intel all pass because
none of these gaps are type errors or unit-test failures — they're missing
call sites. This is the exact "passes every unit gate while fully broken"
pattern this project's process exists to catch, and it happened twice in a
row. Do not repeat it a third time.

## The three tenets — mandatory, every item, no exceptions

1. **Contract definition + enforcement.** State the exact input→output
   contract for each piece BEFORE writing it (function signature, what
   calls it, what it returns, who consumes the return value). After
   writing it, check the diff against that stated contract — not "does it
   compile," but "does something actually call this and use the result."
2. **E2E cycle complete, input to output, across the ENTIRE chain.** For
   this feature that means: real YouTube description → parser invoked →
   row written to `transcript_chapters` → row read back by the client →
   passed into `findEntityTimestamp` → chip/seek behavior actually changes
   because of it. A test file proving the parser function returns correct
   output IN ISOLATION is necessary but NOT sufficient — it is not E2E
   evidence. If you cannot demonstrate the full chain fired (real DB row,
   real client fetch, real function call with the new argument populated),
   say so explicitly instead of reporting done.
3. **Tangent hunt as you walk the workflow.** While touching each file in
   the chain, check adjacent/sibling call sites for the same class of gap
   — e.g. if you fix `DashboardContainer.tsx:203`, check whether ANY other
   caller of `findEntityTimestamp` exists (there is a second call site at
   line 220 in the same file, and MindMap/KnowledgeGraphCanvas were
   claimed in a prior report to "get this for free through
   handleSelectNode" — verify that claim yourself, don't inherit it).

**If you find you cannot complete a full cycle, or discover a design gap
mid-implementation (e.g. no way to represent "parse attempted, found
zero"), STOP and report the specific deviation and why, rather than
shipping a partial wire-up under a "done" label.** A clearly flagged
incomplete item is acceptable. A silently incomplete item reported as done
is not — that is exactly what happened twice already on this feature.

## The four missing connections (fix all four)

### Gap 1 — Parser is never invoked

`worker/src/services/chapter-parser.ts`'s `parseChapters()` exists,
unit-tested, correct (CC fixed a chronology bug in it directly — read the
current file, don't re-derive from an old version). It is never called
anywhere in `worker/src/`. Contract: it must be called wherever
`snippet.description` is available during video metadata processing (see
`MetadataScraper.ts:386` for where `snippet.title` is read from the same
response object — `parseChapters(snippet.description)` belongs near there).

### Gap 2 — Parsed chapters are never persisted

Even once Gap 1 is fixed, the parser's return value (`VideoChapter[]`)
needs an actual insert into `public.transcript_chapters` (upsert on
`(video_id, idx)`, matching the migration's unique constraint). Find
wherever the worker currently persists other per-video derived data (the
`transcripts`/`transcript_markers` insert pattern from migration
`20260718000000_add_transcripts_and_markers.sql` is the sibling to model
this on) and add the equivalent write for chapters. If `parseChapters`
returns an empty array (real attempt, no markers found in the description),
decide and implement how that's represented in storage — this directly
feeds Gap 4's chip logic, don't leave it ambiguous. State your decision
explicitly (e.g. a zero-row marker record, or a separate status column) —
this is exactly the kind of design gap the tenets above want you to flag,
not silently paper over.

### Gap 3 — Client never fetches or passes chapters to `findEntityTimestamp`

`web/lib/utils/entity-time-seek.ts`'s `findEntityTimestamp(node,
dimensionContent, chapters?)` takes an optional third argument. BOTH real
call sites in `web/components/containers/DashboardContainer.tsx` (line 203
and line 220 — a retry-on-race-condition path, don't fix only one and miss
the other) currently call it with 2 arguments. Contract: chapters for the
current video need to be fetched into a store/hook (find the existing
pattern other per-video derived data uses — e.g. how
`useAnalysisDimensionsStore` gets populated — and follow it, don't invent a
new fetch mechanism) and threaded through to both call sites.

### Gap 4 — RPC never returns `has_chapters`

`public.get_user_history_overview` (latest version:
`supabase/migrations/20260802174120_history_overview_function_v12_deterministic_tz_safe.sql`
— confirm this is still the latest before writing v13, a newer migration
may exist by the time you start) has no `has_chapters` column in its
`RETURNS TABLE` or `SELECT`. AGY's prior report claimed "Domain & RPC
Alignment" and added `hasChapters: row.has_chapters ?? null` in
`web/lib/utils/history-overview.ts` — that TypeScript code is fine and
already merged, but since the RPC never sends the field, it evaluates to
`null` on every single row forever (chip renders grey unconditionally —
verified by CC via direct grep of every `has_*` column across all
`history_overview_function_v*.sql` migrations). Write migration v13 adding
`has_chapters boolean` via `exists (select 1 from
public.transcript_chapters where video_id = a.base_video_id)` (three-state
semantics depend on Gap 2's decision about how "attempted, empty" is
represented — this may need `case when exists(...) then true when
<attempted-empty-marker> then false else null end`, follow the v12 file's
own structure/comment style exactly, and keep the `revoke execute ... from
anon, authenticated, public` line v12 already has).

## Mandatory sub-check (project CLAUDE.md, load-bearing)

Any new/replaced `SECURITY DEFINER` function needs an explicit REVOKE
unless meant to be client-callable — this project has been bitten by
forgetting this twice already (PR #179, and CC caught it missing on the
`transcript_chapters` migration's `purge_expired_chapters`/
`compliance_check_chapters` before this prompt, already fixed). Don't
reintroduce the gap on v13.

## E2E verification required (not optional, not "trust the unit tests")

Pick ONE real video with an actual chapter-formatted description (or
construct one), and walk the entire chain with real evidence at each hop:
1. Confirm the worker actually calls `parseChapters` on that video (log
   output, or a direct invocation showing non-empty result during
   processing).
2. Confirm a real row lands in `public.transcript_chapters` for that
   video_id (`execute_sql` query, not a mock).
3. Confirm the client actually fetches that row and it reaches
   `findEntityTimestamp`'s third argument as a non-empty array (not just
   that the function signature accepts it).
4. Confirm `get_user_history_overview` returns `has_chapters: true` for
   that video's history row (`execute_sql` against the RPC directly).
5. Confirm the chip renders green for that video, grey for a video that
   predates the feature.

If you cannot run a live dev instance to observe steps 3/5 visually,
substitute the closest verifiable proxy (e.g. a test that exercises the
full chain through mocked-but-realistic boundaries) AND explicitly say
that's what you did, so CC knows the visual confirmation is still
outstanding rather than assuming it happened.

## Skills — enumerate live, not from memory

CORE: qa-intel, contract-auditor, `/simplify`.
SELECT (checked fresh against `.claude/skills/pr-review-workflow`): new
migration → `supabase-postgres-best-practices` + `supabase`. New
persist/fetch path → check for the `HexagonalBoundaryRule`/adapter pattern
qa-intel already enforces (Supabase access must stay in `adapters/`).
React state/fetch changes in `DashboardContainer.tsx` →
`react-best-practices`.

## Report format (mandatory) — one row per gap, all four required

For EACH of the 4 gaps: RCA → Contract → Fix → E2E proof (cite the actual
command/query output, not "tests pass") → Tangents found while touching
this file → Deviations flagged (if any) → Files changed. Then one combined
Gates section (tsc/vitest/qa-intel/contract-auditor/supabase-postgres-best-
practices) at the end. CC will independently re-run the E2E chain
end-to-end before accepting this as done — a report claiming completion
without the E2E proof for all 5 steps above will be rejected and sent back,
same as this pass was.
