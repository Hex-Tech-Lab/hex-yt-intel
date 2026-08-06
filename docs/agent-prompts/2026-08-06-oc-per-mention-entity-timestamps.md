# OC Prompt — ADR 022: Per-Mention Entity Timestamp Resolution

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — read it now
if you haven't already. Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md`
before touching any file; post `[IN_PROGRESS]` with intent + target files as
your first action; re-check the ledger after every subtask; post
`[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually
happened (not what you intended) as your last action.

**Check the ledger specifically for an in-flight agent working PR #207**
(`fix/wordcloud-cluster-and-date-title` → merge) before starting — that
agent may be touching `web/components/templates/console/WordCloud.tsx` and
`web/components/containers/DashboardContainer.tsx` concurrently. This task
works on `main` (or a fresh branch off `main`) AFTER PR #207 merges — if
#207 hasn't merged yet when you start, check `gh pr view 207` and either
wait or coordinate via the ledger rather than branching off a stale `main`.

## 1. Context

Read `docs/specs/ADR_022_PER_MENTION_ENTITY_TIMESTAMP_RESOLUTION_2026-08-06.md`
in full FIRST — it has the complete origin story, research basis, scope
decision (v1 text-layer-only, no schema/pipeline change), and the exact
function contract this task implements. This prompt summarizes it but the
ADR is the source of truth; if anything here conflicts with the ADR, the
ADR wins.

One-paragraph summary: `web/lib/utils/entity-time-seek.ts`'s
`findEntityTimestamp` always resolves to the FIRST occurrence of an
entity's label in the dimension content (`dimensionContent.indexOf(label)`
— a single lookup, not a search over all occurrences). Every panel that
lets a user click an entity (WordCloud, KnowledgeGraphCanvas, MindMap,
IntelligencePanel) goes through `DashboardContainer.handleSelectNode`,
which calls this function — so every click on a given entity seeks to the
identical timestamp, which is the confirmed root cause of a live-reported
bug: "entity clicks all jump to pretty much the same place, mostly the
first minute." This task fixes it at the source (all callers inherit the
fix automatically through the shared `handleSelectNode` path) rather than
patching each panel separately.

## 2. Task

**2a. Extend `web/lib/utils/entity-time-seek.ts`** with two new exported
functions per the ADR's exact contract (§4):

```ts
export interface EntityMentionMatch {
  timestamp: string;
  seekSeconds: number;
  occurrenceIndex: number;
}

export function findAllEntityMentions(
  node: EntityTimeSeekNode,
  dimensionContent?: string | null,
  chapters?: EntityTimeSeekChapter[] | null,
): EntityMentionMatch[];

export function findNearestEntityMention(
  node: EntityTimeSeekNode,
  dimensionContent: string | null | undefined,
  chapters: EntityTimeSeekChapter[] | null | undefined,
  currentPlaybackSeconds: number | null,
): EntityMentionMatch | null;
```

`findAllEntityMentions` reuses the EXISTING search logic in
`findEntityTimestamp` (label/content/keyTerms direct matches, then
dimension-content proximity search) but must find ALL occurrences, not
stop at the first:
- `node.label`/`node.content`/`node.keyTerms` direct-field matches: if a
  timestamp literal is present in these fields, that's still a single
  authoritative match (unchanged from today) — these fields don't have
  "multiple occurrences" the way dimension prose does.
- The dimension-content fallback is where multiplicity actually matters:
  today's code does `dimensionContent.indexOf(label)` (first occurrence
  only) then searches backward for the nearest preceding timestamp. Change
  this to find EVERY occurrence of `label` in `dimensionContent` (loop
  `indexOf` from each previous match's end, or use a properly-escaped
  regex with the `g` flag — label text can contain regex special
  characters, escape it), and for each occurrence, run the SAME
  nearest-preceding-timestamp logic (including the existing range-handling
  and chapter-boundary-snapping) that today's single-occurrence path
  already has. Do not duplicate that logic — extract it into a shared
  helper called once per occurrence.
- Do not simplify away the existing range-format handling
  (`TIMESTAMP_RANGE_RE`, "60:00 to 65:00") or chapter-boundary snapping
  (`applyChapterBoundary`) — both must still apply per-occurrence.
- Preserve `findEntityTimestamp`'s existing signature and behavior
  UNCHANGED — it's still used/exported for any caller that doesn't need
  playback-position-aware selection. Implement it in terms of the new
  function if that's cleaner (e.g. `findEntityTimestamp = (...) =>
  findAllEntityMentions(...)[0]?.timestamp ?? null`), but verify this
  produces IDENTICAL output to the current implementation on the existing
  test suite before treating it as a safe refactor — if behavior differs
  even slightly (e.g. label/content/keyTerms field priority order), keep
  the implementations separate rather than forcing a shared one.

`findNearestEntityMention` calls `findAllEntityMentions`, then:
- If the mention list is empty, return `null`.
- If `currentPlaybackSeconds` is `null`/`undefined`, return the FIRST
  mention (today's behavior, unchanged for that case — matches the ADR's
  explicit fallback rule).
- Otherwise return the mention whose `seekSeconds` has the smallest
  absolute distance to `currentPlaybackSeconds`.

**2b. Wire `currentPlaybackSeconds` from the actual video player.** Check
`web/store/useVideoStore.ts` — as of this prompt it has NO field tracking
current playback position (only `seekTo`, a write-only seek TARGET). Find
where the actual video player component is (search for the player
component that consumes `seekTo`/renders the iframe/video element —
`grep -rl "seekTo" web/components/`) and check if it already tracks
`currentTime` locally (a `timeupdate` listener or similar) without
exposing it to the store. If so, lift that into a new
`currentPlaybackSeconds: number | null` field on `useVideoStore` (updated
on the player's existing time-update mechanism, not a new polling loop —
reuse what's already there). If the player currently has NO time-tracking
at all, that's a bigger gap than this ADR anticipated — STOP and flag it
per the three tenets rather than building a new player-instrumentation
subsystem un-reviewed; a reasonable minimal addition (a `timeupdate`/
`ontimeupdate`-equivalent listener wired to `setCurrentPlaybackSeconds`) is
in scope if it's a small, obvious addition to an existing player component,
but a significant new mechanism is not — use judgment and report which
case this was.

**2c. Switch the caller.** In
`web/components/containers/DashboardContainer.tsx`'s `handleSelectNode`
(currently ~line 200-238, calls `findEntityTimestamp(node, dimContent,
chapters)` and again in the retry-subscribe branch for a not-yet-streamed
dimension), switch both call sites to
`findNearestEntityMention(node, dimContent, chapters,
useVideoStore.getState().currentPlaybackSeconds ?? null)`, then use
`.timestamp` from the returned `EntityMentionMatch` (or `null`) in place of
the raw string `findEntityTimestamp` used to return. Preserve all
surrounding logic (the `parseTimestamp`/`setSeekTo` calls, the
dimension-not-yet-streamed retry-with-timeout logic) unchanged — only the
timestamp-resolution call itself changes.

## 3. Goal / definition of done

A user clicking the SAME entity multiple times from different panels (or
different words in WordCloud that share a node id, post-#207) now resolves
to whichever occurrence is closest to where the video currently is, not
always the first occurrence in the transcript. Verified with a real test
case: an entity mentioned at multiple timestamps in a dimension's content,
current playback position set to a value nearer the SECOND mention than
the first, `findNearestEntityMention` returns the second mention's
timestamp — not the first (this is the exact behavior change from today's
bug).

## 4. Expected results

- `entity-time-seek.ts`: `findAllEntityMentions` + `findNearestEntityMention`
  exported, `findEntityTimestamp` behavior-preserved (existing test suite
  for it still passes unmodified, or with equivalent coverage if you
  refactored its implementation).
- New test cases in the existing `entity-time-seek.test.ts` (find it —
  this function already has test coverage, follow its existing patterns)
  covering: multiple occurrences found correctly, nearest-to-playhead
  selection picks the right one, null-playhead fallback to first mention,
  empty-mentions returns null, chapter-boundary snapping still applies
  per-occurrence, range-format timestamps still handled per-occurrence.
- `useVideoStore.ts`: `currentPlaybackSeconds` field added IF the player
  already has an obvious, small wiring point (per 2b) — otherwise flagged,
  not built.
- `DashboardContainer.tsx`: both `handleSelectNode` call sites switched.
- No change to `WordCloud.tsx`, no change to any persistence/worker/schema
  code, no video/audio processing added — per the ADR's explicit non-goals.

## 5. Task-specific skills/tools/plugins/MCPs

CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets are
[ALWAYS INCLUDE] below. Beyond that: `react-best-practices` applies to
2b (player time-tracking wiring, if built — watch for a naive
per-frame/high-frequency state update causing excess re-renders; a
`timeupdate`-driven update at native browser cadence, or throttled, is
fine — a `requestAnimationFrame` loop writing to Zustand every frame is
not). No Supabase/DB/worker work in this task — no Supabase MCP needed.

## 6. Fixtures

Run `code-review-graph`'s `build_or_update_graph_tool` then
`get_review_context_tool`/`get_impact_radius_tool` scoped to
`web/lib/utils/entity-time-seek.ts`,
`web/components/containers/DashboardContainer.tsx`,
`web/store/useVideoStore.ts`, and whichever player component 2b identifies,
before reading full files. Read the EXISTING test file for
`entity-time-seek.ts` first (`web/lib/__tests__/entity-time-seek.test.ts`
or similar — find via grep) as the established pattern to follow for new
test cases. Start from `main` at whatever commit PR #207 merged as (verify
via `git log --oneline -1` — confirm PR #207's WordCloud/history-overview/
digest-sync fixes are present before assuming a clean baseline).

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the exact input→output
   contract for each new function before writing it (the ADR already gives
   you the type signatures — restate what each one guarantees in plain
   language, then check your diff against that).
2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
   passing unit test on `findNearestEntityMention` in isolation is NOT
   sufficient — trace the real path: does `handleSelectNode` actually call
   it with a real `currentPlaybackSeconds` value (not always null because
   2b's wiring silently failed), does `setSeekTo` actually receive the
   right seconds.
3. **Tangent hunt.** While in `entity-time-seek.ts`, check whether
   `applyChapterBoundary`'s tie-breaking logic (documented in its own
   comment) still behaves correctly when called once per occurrence instead
   of once total — same input, called N times instead of once, should
   still produce N independently-correct results, not an aggregate bug.

**If you cannot complete a full cycle or find a design gap (especially in
2b's player-wiring step), STOP and flag the specific deviation.**

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
