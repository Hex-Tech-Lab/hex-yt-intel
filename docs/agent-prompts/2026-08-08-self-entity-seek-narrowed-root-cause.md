# Agent Dispatch — Entity-seek nav-remount bug, narrowed to findNearestEntityMention's inputs

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `CLAUDE.md` §2 "SHARED COMMUNICATION PROTOCOL" in full. Read
`.memory/AGENT_LEDGER.md` before touching any file (a prior attempt at this
exact task was BLOCKED for lack of live auth — read its ledger entry,
commit `6bebdc6c`, for context, then proceed past it: this dispatch supplies
what that attempt was missing). Post `[IN_PROGRESS]` with intent + target
files as your first action. Post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a
real summary as your last action.

## 1. Context

hex-yt-intel Next.js/Zustand app. This is the THIRD dispatch for the same
confirmed live-repro bug (entity-click seek silently no-ops after
Console→History→Console navigation). The first two attempts failed for
different reasons: attempt 1 code-traced only and shipped an unrelated fix
(PR #217, merged — real bug, wrong bug). Attempt 2 correctly refused to
guess without live auth and stopped (correct behavior, but made no
progress).

**This dispatch supplies what was missing: live runtime evidence gathered
directly against a real authenticated session this session, narrowing the
bug dramatically.** Read this evidence carefully — it rules out several
plausible-sounding hypotheses definitively, so don't re-investigate them.

### Confirmed repro (unchanged from before, still reproduces on latest `main` post-PR-#217)

1. Load completed analysis `jqvmORIAQjg` ("Patrick Winston — How to Speak")
   in Synthesis Console.
2. Click Play once (video facade → real iframe, `VideoPlayerCard`'s local
   `interacted` state → `true`).
3. Enable "Entity Click Time-Seek" toggle.
4. Click a Word Cloud word → works, real seek (baseline confirmed).
5. Navigate to "Analysis History", then back to "Synthesis Console" (same
   analysis). `VideoPlayerCard`'s `interacted` resets to `false` (proof
   that subtree remounted).
6. Click a Word Cloud word → **broken**, zero video response.

### NEW evidence this session (via live React-fiber introspection through
### Claude-in-Chrome's `javascript_tool`, executed directly against the
### failing page state)

Using `document`/React fiber traversal (`__reactFiber$*` keys on DOM nodes)
on the WordCloud `<canvas class="js-word-cloud-canvas">` element's own hook
state, confirmed ALL of the following are working correctly, even in the
FAILING (post-nav) state:

- **WordCloud's pixel hit-testing works.** `wordsLayoutRef` (hook idx4)
  contained 15 real `PlacedWord` objects. Clicking the word "research"
  resolved via `getWordAtCoords` to a real word object.
- **The word→node-id resolution is correct.** The clicked word's `.id`
  resolved to `"node_1"`, a real, valid entry in `graph.nodes` (confirmed
  by reading the `graph` prop directly off the `IntelligencePanel`/canvas
  fiber's props — `graph.nodes` had 13 real entities, `node_1` = "Patrick
  Winston", `dimension: 8`, `content: "MIT faculty, authority on
  presentation and public speaking techniques, AI researcher demonstrating
  effectiveness of structured communication."`, `keyTerms: ["MIT",
  "lecturer", "communication expert", "AI research"]`). Note this content
  literally contains the substring "MIT" (the word that was clicked to
  trigger this path in an earlier repro run).
- **`onSelect(newId)` DOES get called and DOES commit.** `lastSelfSelectedIdRef.current`
  (set synchronously in `WordCloud.tsx`'s `handleMouseClick`, BEFORE the
  `startTransition`-wrapped `onSelect` call) read `"node_1"` after the
  click. The `selectedId` PROP (passed down from `DashboardContainer`'s
  `selectedNodeId` state, which only `handleSelectNode`'s
  `setSelectedNodeId(id)` call can update) ALSO read `"node_1"` when
  re-checked. This proves `onSelect` → `handleSelectNode` → `setSelectedNodeId`
  ran to completion, the `startTransition` committed, and
  `DashboardContainer` re-rendered with the new selection.
- **The Insights sidebar (`IntelligencePanel`) visibly updated correctly**
  to show "DIMENSION 08 · foundational · Patrick Winston" with keyTerms
  "MIT, lecturer, communication expert, AI research" — the exact data for
  `node_1`. This confirms `graph.nodes.find((n) => n.id === id)` inside
  `handleSelectNode` (`DashboardContainer.tsx`, the block gated by
  `if (entityTimeSeekEnabled && graph.nodes)`) DID find the node (`node`
  was truthy), meaning `entityTimeSeekEnabled` read `true` at that point
  too (otherwise the whole block, including the `graph.nodes.find` call,
  would never execute, and other consumers of `selectedNodeId` like
  `IntelligencePanel` would still update from the `setSelectedNodeId` call
  OUTSIDE that gated block — so this alone doesn't 100% prove
  `entityTimeSeekEnabled` was true, see Step 1 below for how to confirm).
- **The toggle switch visually reads ON** in the UI at all times during
  this failing state (screenshot-verified).

### What this evidence rules IN as the remaining failure surface

Given `node` (the found `graph.nodes` entry) is real and has valid
`dimension: 8` and content containing "MIT", the remaining code inside
`handleSelectNode`'s `if (node) { ... }` block
(`DashboardContainer.tsx`, roughly lines 214-244) is:

```js
const dim = useAnalysisDimensionsStore.getState().getDimension(node.dimension);
const dimContent = dim?.content;
const timestamp = findNearestEntityMention(node, dimContent, chapters, useVideoStore.getState().currentPlaybackSeconds ?? null)?.timestamp ?? null;
if (timestamp) {
  setSeekTo(secs);
} else if (!dim) {
  // retry-subscribe branch
}
```

If `dim` is falsy (dimension 8's content isn't in `useAnalysisDimensionsStore`
after the remount), the retry-subscribe branch fires — but that branch only
resolves if the dimension LATER streams in, which never happens for a
completed/restored analysis, so it silently times out after 15s with zero
visible effect (matches the observed symptom: total silence, no error).

If `dim` IS truthy (content present) but `findNearestEntityMention` still
returns `null` (e.g., a stale/wrong `chapters` value, a bad
`currentPlaybackSeconds` value like `NaN` or a huge/invalid number after
the video remount, or some other input state corrupted specifically by the
remount), NEITHER branch fires — also silent, also matches the symptom.

### ADDITIONAL finding this session (source tracing, after the live evidence above)

Traced `useAnalysisDimensionsStore` (`web/lib/stores/analysis-dimensions-store.ts`)
end to end. Its `addDimension()` is called from EXACTLY 2 places in the
whole codebase: `web/lib/adapters/stream-delta-handler.ts:165` and
`web/lib/adapters/synthesis-stream-adapter.ts:157` — both live-SSE-streaming
adapters. **Neither restore path** (`AnalysisHistory.tsx`'s click handler,
`useAutoRestoreAnalysis.ts`'s auto-restore effect) ever calls `addDimension`
— they only call `useSynthesisNucleus`'s `initializeAnalysis`, which
populates a COMPLETELY DIFFERENT store's field
(`useAnalysisStateStore.analysis.dimensions`, a plain object keyed by
dimension number, set directly from the restore payload) and never touches
`useAnalysisDimensionsStore` at all.

This means `useAnalysisDimensionsStore.getState().getDimension(n)` — the
ONE `handleSelectNode` actually calls — may be structurally incapable of
returning data for ANY restored/history-loaded analysis, regardless of the
nav round-trip. This is suspicious on its own (a real, possibly separate
bug: two parallel "current dimension content" stores that don't stay in
sync, one used for rendering the Synthesis Console tab's dimension cards —
which DOES show real content for restored analyses, so THAT rendering path
reads a different, correctly-populated source — and a different one used
by `handleSelectNode`'s entity-seek lookup).

**This does NOT fully explain the nav-specific trigger** (baseline entity
click, no nav, worked) — so either (a) something ELSE populates
`useAnalysisDimensionsStore` shortly after initial restore/page-load in a
way that gets undone specifically by the nav round-trip, or (b) the
baseline "success" observed this session went through a different code
path than assumed and needs re-examination. **Ruled out**: `useInputStore`'s
`url` field (which gates `useAutoRestoreAnalysis`'s reset-on-empty-url
branch) is set-once and never cleared by the nav switch — traced the
`useEffect` at `DashboardContainer.tsx` lines ~165-174, its dependency
array is `[videoMetadata?.videoId, nucleusAnalysis?.videoId]`, neither of
which changes on an `activeNav` switch — so that specific reset trigger
does not fire here. Don't re-investigate it.

**This is exactly the kind of ambiguity Step 1's live console.log
instrumentation will settle in one shot** — log `dim` and
`useAnalysisDimensionsStore.getState()`'s full contents (not just for
the clicked dimension) at the top of `handleSelectNode`, on BOTH a
baseline click and a post-nav click, and diff them. Do this before forming
any further hypothesis.

## 2. Task

**Step 1 — confirm exactly which of the two failure modes above is real,**
using live browser instrumentation (you have Claude-in-Chrome tools, see
section 5). Do NOT just re-read the code and guess between them — add a
temporary `console.log` (or use a debugger breakpoint) at the TOP of
`handleSelectNode` logging `entityTimeSeekEnabled`, `node?.dimension`,
`dim` (from `useAnalysisDimensionsStore.getState().getDimension(node.dimension)`),
`chapters`, and `useVideoStore.getState().currentPlaybackSeconds`, deployed
to a throwaway branch/preview, then run the confirmed repro sequence
(section 1) against it and read the actual console output. This settles it
definitively in one repro cycle instead of more guessing.

**Step 2 — trace WHY that specific input is wrong/stale after the remount.**
- If `dim` is the problem: trace `useAnalysisDimensionsStore`'s own
  hydration. Is it populated from the SSE stream only (and thus genuinely
  empty for a RESTORED/completed analysis that never streamed in this
  session)? Check `useAutoRestoreAnalysis.ts`/`AnalysisHistory.tsx`'s
  restore path — does it populate `useAnalysisDimensionsStore` at all, or
  only `useSynthesisNucleus`/`analysis-metadata-store`? If dimensions store
  is never populated on restore, this bug would affect ANY entity click on
  a restored analysis, nav round-trip or not — but baseline (no nav) DID
  work, so check specifically whether something CLEARS
  `useAnalysisDimensionsStore` specifically ON the nav-to-history action
  (e.g. a cleanup effect keyed on `activeNav` or an unmount effect in
  whatever component wraps the console view).
- If `chapters`/`currentPlaybackSeconds` is the problem: trace where
  `chapters` comes from in `DashboardContainer` (a hook call, check its
  dependency array for anything that could reset it on the nav switch) and
  whether `currentPlaybackSeconds` gets set to something like `NaN` when
  `VideoPlayerCard` remounts and its internal poll loop hasn't started
  ticking yet (the value might be stale from BEFORE the remount, held in
  the global `useVideoStore`, not reset — check `findNearestEntityMention`'s
  actual matching logic in `web/lib/utils/entity-time-seek.ts` for what a
  stale/very-large `currentPlaybackSeconds` does to its nearest-mention
  distance calculation, e.g. if it filters out all mentions as "too far").

**Step 3 — fix the confirmed root cause.**

## 3. Goal / definition of done

The confirmed 6-step repro (section 1) results in a real seek at step 6,
verified live by you against a real browser session, with the specific
failing input identified via actual logged/observed values (not inferred).

## 4. Expected results

- Root cause identified with a real logged value showing the actual failure
  (e.g. "`dim` was `undefined`" or "`currentPlaybackSeconds` was `47000`
  when the video is 62 minutes long" — a concrete fact, not a guess).
- Fix in the actual root-cause layer.
- A regression test if the mechanism can be simulated without a real
  browser remount (e.g. a Testing Library test that mounts/unmounts
  `DashboardContainer`'s relevant subtree and asserts the dimension store
  or chapters/playhead state survives correctly). If it genuinely can't be
  unit-tested, say so explicitly.
- Live re-verification with before/after evidence in your report.

## 5. Task-specific skills/tools/MCPs

Claude-in-Chrome browser tools (load via `ToolSearch` query
"select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__read_network_requests,mcp__claude-in-chrome__javascript_tool").
For live auth: navigate to `https://yt-intel.getmytestdrive.com/dashboard`
(production, already has a valid session in this browser profile if you're
running in the SAME browser context as this conversation — check
`tabs_context_mcp` first; if a tab already shows the dashboard signed in as
"kellybakri", REUSE it, don't sign out). If no authenticated tab exists,
your task-brief predecessor correctly identified this as a hard blocker —
in that case, deploy your instrumented branch to a Vercel preview and
report back with the preview URL, asking the user to sign in once, same as
this session did successfully. Do not attempt to handle credentials
yourself.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Run `code-review-graph` MCP's `build_or_update_graph_tool`
then `get_review_context_tool`/`get_impact_radius_tool` scoped to
`web/components/containers/DashboardContainer.tsx`,
`web/lib/stores/analysis-dimensions-store.ts` (verify exact path via the
graph tool), `web/lib/utils/entity-time-seek.ts`,
`web/hooks/useAutoRestoreAnalysis.ts` before reading full files.

**[FILL IN]**: Start from `main` (check `git log -1` first for latest tip).

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.**
2. **E2E cycle complete, input to output, across the ENTIRE chain.** Live
   browser re-verification of the exact 6-step repro is mandatory — this is
   the third attempt at this bug specifically because the first two skipped
   this.
3. **Tangent hunt as you walk the workflow.** Check whether the same
   store-hydration-on-restore gap (if that's the root cause) affects
   anything else that reads `useAnalysisDimensionsStore` for a restored
   analysis.

If you cannot get live browser verification working, STOP and report that
specific blocker with exactly what you tried, rather than shipping an
unverified code change under a "done" label.

## 8. Report format — [ALWAYS INCLUDE]

RCA (with the specific logged/observed value that confirmed it) → Contract
→ Fix → E2E proof (live repro before/after, concretely described) →
Tangents found → Deviations flagged (if any) → Skills run + findings →
Gates (exact output) → Files changed.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
```
