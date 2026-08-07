# Agent Dispatch Prompt — Entity-Seek Still Resolving to ~0:00 Despite ADR 022 (OC)

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — read it now
if you haven't already. Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md`
before touching any file; post `[IN_PROGRESS]` with intent + target files as
your first action; re-check the ledger after every subtask; post
`[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually
happened (not what you intended) as your last action; use the
`[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.

## 1. Context

hex-yt-intel: YouTube video analysis platform, Next.js/React 19/Zustand,
`web/` directory. ADR 022 (`docs/specs/ADR_022_PER_MENTION_ENTITY_TIMESTAMP_RESOLUTION_2026-08-06.md`)
replaced "always seek to the FIRST occurrence of an entity's label" with
per-mention resolution nearest the current playhead — merged as PR #208,
plus a post-review fix pass (ledger entry `2026-08-06T16:56:00+03:00`)
that fixed 4 real bugs found in the original implementation (unthrottled
polling, whole-store re-render fan-out, missing video-ENDED handling, an
`occurrenceIndex` off-by-position bug).

**User's live iPad test report (2026-08-07), verbatim**: "when you enable
the time seek button and you click on any of them, again it's the same
terrible resolution, so it's actually they almost all go to the same spot,
and almost invariably it's at the beginning of the video, either the 0:0
time slot or somewhere just in the beginning, hardly ever pointing to the
right location of any entity. So that probably means that the algorithm is
incorrect or the work done hasn't landed yet." This is AFTER ADR 022/PR
#208 merged — either a real regression, a gap the post-review pass didn't
catch, or a wiring issue where the new logic isn't actually the code path
being exercised.

Separately, the WordCloud clustering bug (a DIFFERENT, already-fixed issue
where multiple distinct words shared one `node.id` and cross-highlighted
together — see `docs/history/` session notes if you want that history) is
confirmed fixed per the same test: "the entities in the word cloud are now
separated... it does not bundle a few of them together as previously." So
whatever's still broken is downstream of a correctly-identified single
entity, not the earlier clustering bug re-appearing.

## 2. Task

Investigate why entity-seek still resolves to (or near) 0:00 for most
clicks, live-testing the actual behavior, not just re-reading the code and
assuming it's correct.

**A concrete, plausible, UNVERIFIED lead to check first** (found via a code
read, not confirmed via live testing — verify or rule this out with real
evidence, don't just assume it's the answer):
`web/lib/utils/entity-time-seek.ts`'s `findNearestEntityMention` (lines
~224-237) explicitly falls back to `mentions[0]` (the first/earliest
occurrence in the dimension content) whenever `currentPlaybackSeconds` is
`null`:
```
if (currentPlaybackSeconds === null || currentPlaybackSeconds === undefined) return mentions[0]!;
```
`currentPlaybackSeconds` (`web/store/useVideoStore.ts`) defaults to `null`
and is only populated once the video actually starts playing and the
playback-poll interval (`VideoPlayerCard.tsx`, fixed to a real `setInterval`
in the PR #208 post-review pass) has fired at least once. If a user opens
an analysis and clicks entities in the word cloud/graph BEFORE ever
pressing play — a very plausible, maybe the MOST common, real workflow —
`currentPlaybackSeconds` stays `null` the entire time, so EVERY entity
click resolves to `mentions[0]`, which for most dimensions is near the
start of that dimension's content. That would reproduce "they almost all
go to the same spot, almost invariably at the beginning" exactly.

Also check the OTHER gap this project's own ledger already flagged as
known-but-not-fully-fixed: `2026-08-06T16:56:00+03:00`'s entry mentions
"cheap onPause-time position capture (documented, not a full fix, for the
narrower paused-scrub gap)" — if a user pauses the video, scrubs the
timeline, then clicks entities, does `currentPlaybackSeconds` actually
reflect the scrubbed position, or does it stay stale at wherever it was
when `isPlaying` last flipped false? This could be a second, related
contributor.

Do NOT assume either of these is definitely the fix without live-testing
it — trace the real component tree, actually exercise the click path (via
whatever browser/dev-server access you have), and confirm with real
evidence which hypothesis (or a different one you find) actually explains
the reported symptom before writing a fix.

## 3. Goal / definition of done

A confirmed root cause, backed by real reproduction (not just code
inspection), for why entity-seek resolves near 0:00 most of the time
post-ADR-022. A fix that makes entity-seek actually resolve to a timestamp
near the clicked entity's real mention, verified the same way (real click,
real resulting seek position, not a passing unit test in isolation).

## 4. Expected results

- RCA in the report naming the exact mechanism (playhead-null fallback,
  paused-scrub staleness, both, or something else entirely).
- Fix applied. If the root cause is "playhead is null before first play,"
  consider whether the right fix is: (a) track the LAST-KNOWN seek/scrub
  position even before play starts (e.g. video player's initial-load
  position, or 0 only as an explicit last resort, not the reason every
  mention collapses to mentions[0]), or (b) something else you judge
  correct after investigating — state your reasoning, don't just patch the
  symptom.
- Regression test added for whatever the actual bug turns out to be (this
  repo now has happy-dom + RTL via ADR 024 — a real component-level test is
  possible now if that's the right test shape; a pure-function test on
  `entity-time-seek.ts` if the bug is there instead).

## 5. Task-specific skills/tools/plugins/MCPs

CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets are
[ALWAYS INCLUDE] below. Beyond that: `react-best-practices` applies
(playback state timing/subscription correctness). If you have any way to
actually run the dev server and click through a real analysis (this
project's `run` skill, or manual `pnpm dev` + browser), USE it — this bug
class ("verified in isolation, broken end-to-end") has bitten this exact
feature twice already (see ledger entries `2026-08-06T15:08:00` and
`2026-08-06T16:56:00`), both times because a fix was accepted on
code-reading confidence alone without live reproduction.

## 6. Fixtures

**code-review-graph MCP**: this project's CLAUDE.md mandates
`build_or_update_graph_tool` then `get_review_context_tool`/
`get_impact_radius_tool` as Step 0 before Grep/Glob/Read. If that MCP
server isn't connected in your environment, fall back to Grep/Read directly
and note the fallback in your report.

Start from `main` at commit `383f9be8` or later. Read
`web/lib/utils/entity-time-seek.ts` in full, `web/store/useVideoStore.ts`,
`web/components/templates/console/VideoPlayerCard.tsx` (the playback-poll
mechanism), and `web/components/containers/DashboardContainer.tsx`'s
`handleSelectNode` (search for `findNearestEntityMention` — it's the call
site) as the starting points.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the exact input→output
   contract for the fix BEFORE writing it. After writing it, check the diff
   against that contract.
2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
   passing unit test on `entity-time-seek.ts` in isolation is NOT
   sufficient evidence — this exact feature has already had two rounds of
   "verified in isolation, broken end-to-end." Trace the real path: open a
   real analysis, click a real entity, confirm the ACTUAL resulting seek
   position matches the entity's ACTUAL mention location in the real
   dimension content.
3. **Tangent hunt as you walk the workflow.** While in these files, check
   for other places `currentPlaybackSeconds` or playback timing assumptions
   could produce a similar "defaults to wrong value silently" gap.

**If you cannot complete a full cycle, or find a design gap mid-task, STOP
and report the specific deviation and why**, rather than shipping a partial
fix under a "done" label.

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (cite actual reproduction steps and
observed result, not "tests pass") → Tangents found → Deviations flagged
(if any) → Skills run + findings → Gates (exact output) → Files changed. CC
independently re-verifies every claim against real code and real system
state before accepting — a report claiming "done" without this structure,
or without E2E proof, will be rejected and sent back. This feature
specifically has a documented history of agent "done" reports needing
correction after independent re-verification (ledger, twice already) — the
bar for E2E proof on this task is high.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' — empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # EXACT CI flags, not the bare default run
pnpm tsx web/scripts/contract-auditor.ts
```
