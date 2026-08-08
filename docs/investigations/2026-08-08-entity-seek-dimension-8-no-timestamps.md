# Entity-seek nav-remount bug — THIRD dispatch findings (2026-08-08)

Dispatch: `docs/agent-prompts/2026-08-08-self-entity-seek-narrowed-root-cause.md`
Branch: `fix/entity-seek-nav-remount-regression` (commit `6e00971a`, throwaway — not for merge)
Preview: `https://hex-yt-intel-git-fix-entity-seek-na-7d8e13-techhypexps-projects.vercel.app/dashboard`

## Summary

Live instrumentation + a real authenticated Claude-in-Chrome session
**disproves both hypotheses the dispatch asked to distinguish between**, and
surfaces a third, more fundamental cause that is **not nav-specific at all**.
The nav-remount hypothesis itself could not be validated against this
account's data, because the "baseline succeeds" premise it depends on does
not hold here.

## What was done

1. Added temporary `console.log('[ENTITY-SEEK-DEBUG] handleSelectNode', {...})`
   instrumentation to `handleSelectNode` in
   `web/components/containers/DashboardContainer.tsx`, logging
   `entityTimeSeekEnabled`, `node.dimension`, `dim` (the `getDimension`
   result), `analysisStateDimensionsKeys`, `isStreaming`, `chapters`, and
   `currentPlaybackSeconds`.
2. Reused branch `fix/entity-seek-nav-remount-regression` (PR #217's,
   already merged) so the existing authenticated Claude-in-Chrome tab's
   session would carry over to the redeployed preview at the same origin.
   Force-pushed the instrumented commit; Vercel redeployed the same alias.
3. Drove the app live via Claude-in-Chrome: clicked Play, enabled "Entity
   Click Time-Seek", clicked Word Cloud entities, read the real captured
   console output (patched `console.log` in-page to store structured
   objects, since `read_console_messages` only returns `"Object"` for
   non-primitive args).
4. When pixel-coordinate clicking proved unreliable (window resize/layout
   shifts across tool calls), switched to invoking the WordCloud's
   `onSelect` prop directly via React-fiber introspection
   (`canvas.js-word-cloud-canvas`'s `__reactFiber$*` → walk `.return` to the
   nearest `memoizedProps.onSelect`) — same technique the dispatch doc's
   prior live-evidence pass used.

## The account's only analysis

`1 analyses total` for this account (`kellybakri`). The video referenced in
the dispatch doc (`jqvmORIAQjg`) is **not present** — the only analysis is a
different video, `EoKdX13w7SI` ("Patrick Winston — How to Speak", channel
"Mark Johnson", 11/11 dimensions complete, no chapters).

## Real captured evidence

**Baseline click** (real iframe mounted, `interacted=true`) on `node_1`
("Patrick Winston"):

```json
{
  "entityTimeSeekEnabled": true,
  "nodeId": "node_1", "nodeDimension": 8,
  "dimPresent": true, "dimContentLen": 5294,
  "isStreaming": false,
  "analysisStateDimensionsKeys": ["1".."11"],
  "chapters": [], "currentPlaybackSeconds": null
}
```

**Post-nav click** (Synthesis Console → Analysis History → Synthesis
Console; `VideoPlayerCard`'s `interacted` visibly reset — iframe count
dropped from 1 to 0) on the **same** `node_1`:

```json
{
  "entityTimeSeekEnabled": true,
  "nodeId": "node_1", "nodeDimension": 8,
  "dimPresent": true,
  "chapters": [], "currentPlaybackSeconds": null
}
```

**These are byte-identical.** Both of the dispatch's candidate failure
modes are ruled out by direct observation, not inference:

- **Hypothesis A ("`dim` is falsy for a restored analysis")** — false.
  `useAnalysisStateStore.getState().analysis?.dimensions` had all 11 keys
  populated in both baseline and post-nav captures. The restore path (via
  `useSynthesisNucleus`'s `initializeAnalysis`) does populate this store
  correctly for this analysis; `getDimension` resolved dimension 8's real
  content (5294 chars) every time.
- **Hypothesis B ("stale/bad `chapters` or `currentPlaybackSeconds`")** —
  false. Both values were identical (`chapters: []`, since this analysis
  has no chapters at all; `currentPlaybackSeconds: null`, since the video
  was never actually played to a real timestamp in either case). Per
  `findNearestEntityMention`'s own documented behavior
  (`web/lib/utils/entity-time-seek.ts` lines 243-244), `currentPlaybackSeconds
  === null` does **not** cause a null result — it explicitly falls back to
  the mention with the latest `seekSeconds`. A null playhead cannot be the
  differentiator.

## The real (third) cause found live

All 13 knowledge-graph nodes in this analysis are attributed to
**dimension 8** ("Semantic & Knowledge Graph Foundation"):

```
node_1 Patrick Winston            dimension 8
node_2 Presentation Architecture  dimension 8
node_3 Empathetic Mirroring       dimension 8
... (all 13 nodes, all dimension 8)
```

Dimension 8's raw content (fetched live, the actual string
`findNearestEntityMention` receives) is a **structured KG summary list**
("8.1 Primary Knowledge Graph Nodes\n\n1. **Patrick Winston** | type:
person | weight: 9 | ..."), not narrative transcript-derived prose.
Regex-testing the real captured content live:

```js
/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/.test(dim.content)  // => false
```

**Dimension 8's content contains zero inline timestamps anywhere.**
`findAllEntityMentions` therefore returns `[]` for every node in this
analysis, `findNearestEntityMention` returns `null`, `timestamp` is falsy,
and `setSeekTo` is never called — on **every** click, regardless of nav
state.

Confirmed directly: called `onSelect('node_1')` on a **stone-cold fresh
page load** (full reload, single client-side nav History→Console, zero
prior navigation, toggle freshly re-enabled) and the iframe count stayed
at `0` for 800ms after the click — the exact "silent no-op" symptom,
reproduced with **no nav round-trip involved at all**.

## Why this doesn't confirm or deny the nav-remount hypothesis

The dispatch's confirmed 6-step repro depends on step 4 ("Click a Word
Cloud word → works, real seek (baseline confirmed)") succeeding before the
nav round-trip is even attempted. That baseline was established in an
earlier session against `jqvmORIAQjg`, a video no longer present in this
account. Against the only video actually available now (`EoKdX13w7SI`),
step 4 itself fails — for a reason (dimension-8 content structurally
lacking timestamps) that has nothing to do with navigation. This account's
data cannot be used to prove or disprove that remounting `VideoPlayerCard`
independently breaks anything, because there is no successful baseline
click to compare a post-nav click against.

Separately, and worth flagging as its own thread: `VideoPlayerCard.tsx`
lines 157-164 contain an explicit "auto-interact via entity click" path
(`if (!interacted && !embedRestricted) setInteracted(true)` inside the
`seekTo`-effect, intended so an entity click "expresses the same 'play
this video' intent as clicking the play button" even from the facade
state) — but this path only runs at all if `setSeekTo` was called, which
requires a resolved `timestamp` first. For this dataset that never
happens, so this path was never exercised either way; whether it works
correctly remains unverified and is a reasonable next thing to check with
a dataset that has real inline timestamps in the entities' dimension.

## Why this is the right entity-attribution to be suspicious of, and a candidate next step

The dispatch doc itself flags a separate, real, already-documented
suspicion in the surrounding session history: `useKnowledgeGraph.ts`'s
node→dimension attribution has previously been buggy (PR #217 fixed a
missing-dimension fallback for API-sourced nodes; `DEFAULT_KG_EXTRACTION_DIMENSION`
is `8`). **All 13 nodes landing on exactly the sentinel/default dimension
8 for this analysis is itself suspicious** — it may mean these nodes are
falling through to the same default-dimension fallback PR #217 partially
addressed, rather than genuinely being extracted from dimension 8's
content. If so, the fix is upstream of `handleSelectNode` entirely: in
whatever assigns `dimension` to graph nodes at extraction/persistence
time, not in the seek-resolution code path this dispatch targeted. This
was not investigated further this session (out of scope for the
console.log-instrumentation task as briefed) but is the most concrete lead
for a fourth attempt.

## What was NOT done

- No fix shipped. Shipping a change to `findNearestEntityMention`,
  `handleSelectNode`, or `VideoPlayerCard` based on this session's evidence
  would be guessing — the actual confirmed defect (dimension-8-content-has-
  no-timestamps) traces to entity/dimension attribution upstream, which
  this dispatch didn't scope investigating.
- No regression test added (same reason — don't know yet what the correct
  fix target is).
- Temporary `console.log` instrumentation is still present on
  `fix/entity-seek-nav-remount-regression` (commit `6e00971a`) and the live
  Vercel preview. Left in place deliberately in case a follow-up session
  wants to re-run against a better test video; this branch is throwaway and
  should not be merged as-is.

## Recommended next step (fourth attempt)

Trace how `useKnowledgeGraph.ts` (or whatever persists `kg_entities`)
assigns `dimension` for this analysis's 13 nodes — confirm whether they are
genuinely extracted from dimension 8's prose or silently defaulting there.
If a test account/video with entities genuinely spread across
narrative dimensions (which do contain inline `[MM:SS]` timestamps) is
available, re-run this exact live repro against it — that is the only way
to actually test the nav-remount hypothesis this dispatch was built to
confirm.

## Gates run

- `pnpm --filter @hex-yt-intel/web exec tsc --noEmit` — clean (instrumentation-only diff).
- Full gate suite (vitest, verify-quality-engine, contract-auditor) not run
  — no functional/logic change was made, only temporary debug logging on a
  throwaway branch not intended for merge.
