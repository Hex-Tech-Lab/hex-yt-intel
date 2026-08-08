# Agent Dispatch — Entity Mention Timeline Scrubber, Forward/Back Nav, Auto-Segment Playback UI (AGY)

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> Follow `AGENTS.md`/`CLAUDE.md` §2 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.

**A sibling agent (OC, on DeepSeek) is dispatched IN PARALLEL, at the same
time as you, to build the DATA layer (significance scoring, segment
boundaries, persistence) that you CONSUME here. Read §2's "Frozen contract"
section carefully — that exact TypeScript shape is what OC's prompt was
also given, verbatim, identical. You are building the UI against this
shape using REALISTIC MOCK DATA that conforms to it (see §2 Step 0) — do
not wait for OC's implementation to land before starting; that is the
entire point of freezing the contract first. If you find yourself needing
a field this contract doesn't have, STOP and post a `[NOTE]` to the ledger
flagging exactly what's missing and why, rather than inventing a shape
OC isn't building toward.**

## 1. Context

hex-yt-intel: Next.js/React 19/Zustand web app, Tailwind + Astryx design
system (`@astryxdesign/core`, `@astryxdesign/theme-neutral` — NOT shadcn,
confirmed dead/removed from this repo). Entity-click video seeking currently
works (fixed 2026-08-08, PR #222): click an entity in the Word Cloud/Mind
Map/Knowledge Graph panels, it seeks the video to the nearest mention.

**Product direction** (internal ADR doc — ADR 025, private; ask the
orchestrator if you need more than what's inlined below, you likely cannot
read it directly since it lives in a gitignored path not present in your
worktree): this is being upgraded from "seek to one mention" into a full
mention-browsing experience. Your job is the UI for that experience.

## 2. Task

### Frozen contract — [DO NOT MODIFY WITHOUT A LEDGER NOTE]

This exact shape is what you build the UI against (mock data conforming to
it, described in Step 0), and it's the exact shape the sibling OC agent is
implementing server-side, in parallel, right now:

```typescript
export interface RankedEntityMention {
  timestamp: string; // "MM:SS" or "HH:MM:SS", display form
  seekSeconds: number; // parsed start time in seconds
  occurrenceIndex: number;
  segmentEndSeconds: number; // where auto-play should stop and advance
  significance: number; // 0-100, higher = more significant
  dimensionNumber: number;
}

export interface EntityMentionIndex {
  nodeId: string; // matches GraphNode.id
  mentions: RankedEntityMention[]; // sorted by significance descending
}
```

### Step 0 — mandatory pre-flight (read before touching anything)

1. **code-review-graph MCP, Step 0 before Grep/Glob/Read** (per this repo's
   CLAUDE.md mandate): run `build_or_update_graph_tool()` first, then
   `get_review_context_tool()`/`get_impact_radius_tool()` scoped to the
   files named below.
2. **Skim-then-expand contextual pass** — read these in full before writing
   any code:
   - `web/store/useVideoStore.ts` (the existing `setSeekTo`/
     `currentPlaybackSeconds`/`isPlaying` mechanism you must build on top
     of, not replace — `VideoPlayerCard.tsx`'s polling loop already tracks
     `currentPlaybackSeconds` 4x/sec while playing; your auto-segment-advance
     logic should watch this same value, not create a second polling loop).
   - `web/components/templates/console/VideoPlayerCard.tsx` (the actual
     video player component your new scrubber strip mounts near/under —
     read its full render tree to know exactly where the new component
     slots in, and its documented history of hard-won fixes: the
     unthrottled-polling fix, the ENDED-state handling fix, both from
     ADR 022's post-review pass — do not reintroduce either class of bug).
   - `web/components/templates/console/WordCloud.tsx` (specifically its
     `onSelect`/`selectedId` wiring and its own extensive comment history
     about wordKey-vs-node-id selection bugs from PR #207 — your new
     component receives selection state from the SAME `selectedId`/
     `onSelect` contract already shared across WordCloud/MindMap/
     KnowledgeGraphCanvas/IntelligencePanel; do not invent a second,
     parallel selection mechanism).
   - `web/components/containers/DashboardContainer.tsx`'s `handleSelectNode`
     and the `rightPanelItems`/panel-wiring code around it, to see exactly
     where a new UI element would be threaded through.
   - This project's `react-view-transitions`/`web-design-guidelines` skills
     (re-read fresh — don't recall from memory) for the animation/reveal
     pattern conventions already established elsewhere in this codebase
     (e.g. how `DashboardLayout.tsx`'s drawers already do slide/transition
     animations — match that idiom, don't introduce a new animation library
     or pattern).

### Step 1 — Timeline scrubber component

Build a new component (e.g. `web/components/templates/console/EntityMentionTimeline.tsx`)
that:
- Renders a horizontal strip positioned directly under the video player
  (`VideoPlayerCard.tsx`), animated open (slide down) when an entity with
  1+ mentions is selected, animated closed when deselected or when a node
  with zero mentions is selected.
- Shows a marker for EVERY mention in the selected entity's
  `EntityMentionIndex.mentions`, positioned proportionally along the
  video's total duration (need the video's total duration — check
  `VideoPlayerCard.tsx`/`YouTubePlayerAdapter.ts` for how duration is
  already exposed, don't add a second duration-fetching mechanism if one
  exists).
- Distinguishes the currently-active mention visually (the one currently
  playing/selected in the forward/back sequence) from the others.
- Forward/back buttons (or equivalent) step through `mentions` in array
  order (which per the frozen contract is already significance-sorted —
  "forward" means "next most significant," not "next chronologically," and
  should be visually/behaviorally obvious which mode this is).

### Step 2 — Auto-segment playback

When a mention is selected (via a marker click or forward/back), the video
must:
1. Seek to `mention.seekSeconds` (reuse the existing `useVideoStore.setSeekTo`
   action — do not bypass it or write directly to player internals).
2. Play only until `mention.segmentEndSeconds`, then automatically advance
   to the NEXT mention in the array (not stop, not continue playing past
   the boundary) — poll `currentPlaybackSeconds` (already tracked, see
   Step 0) and trigger the advance when it crosses `segmentEndSeconds`.
3. Stop auto-advancing after the last mention in the array (don't wrap
   around, don't fall through to normal continuous playback afterward
   unless the user explicitly resumes it).
4. The chat panel (`ChatDock`) must remain fully interactive throughout —
   verify this isn't accidentally blocked by any overlay/z-index/pointer-events
   change your new component introduces.

### Step 3 — Wire into the existing selection flow

`DashboardContainer.tsx`'s `handleSelectNode` is the existing entry point
for "an entity was clicked." Your new component needs the CURRENT entity's
`EntityMentionIndex` — the sibling OC agent is exposing this via a new
function in `entity-time-seek.ts` (`getRankedMentionsForEntity` or
similar — exact name may differ, that's fine, the DATA SHAPE per §2's
contract is what's frozen, not the accessor function's name). Wire your
component to call it (or, since OC's implementation may not have landed
yet when you're building, wire against a locally-mocked version conforming
to the same shape, clearly marked `// TODO: replace with real
getRankedMentionsForEntity once OC's PR lands` — CC will reconcile this
during the joint review pass, see §3).

## 3. Goal / definition of done

- Clicking an entity with 2+ real mentions (test with mock data conforming
  to §2's contract if OC's real implementation hasn't landed yet) shows a
  timeline strip with the correct number of correctly-positioned markers,
  animates open/closed correctly, and forward/back navigation moves between
  them in the array's given (significance) order.
- Selecting/advancing through a mention seeks and bounds playback to
  `[seekSeconds, segmentEndSeconds)`, auto-advancing to the next mention at
  the boundary, verified live (not just unit-tested) — actually watch the
  video seek and stop/advance in a real browser session.
- Chat panel remains interactive throughout — verified live.
- No regression in the existing single-click-seeks-once behavior for
  entities with only 1 mention (or none) — the new timeline strip should
  not appear/interfere in that case.

## 4. Expected results

- New component: `web/components/templates/console/EntityMentionTimeline.tsx`
  (or your own reasonable naming, documented clearly).
- Modified: `web/components/containers/DashboardContainer.tsx` (wiring
  only), possibly `web/store/useVideoStore.ts` if new state is genuinely
  needed for the segment-queue/auto-advance mechanism (keep additions
  minimal and justify any new store field in a comment).
- Tests: at minimum, marker positioning math (given a mention list + video
  duration, correct pixel/percentage positions), and the segment-boundary
  advance logic (given a `currentPlaybackSeconds` crossing
  `segmentEndSeconds`, the next mention is correctly selected).
- A PR opened via the `/pr-review-workflow` skill, branch
  `feat/entity-mention-timeline-ui-adr025`, targeting `main`. **Do not
  merge — the orchestrator (CC) reviews both this and the sibling OC PR
  together for synchronization before either merges.**

## 5. Task-specific skills/tools/MCPs

`/pr-review-workflow` skill (explicitly invoke it). CORE (qa-intel,
contract-auditor, `/simplify`) always. SELECT: `react-best-practices`
(this is exactly `rerender-`/`client-` category territory — polling,
animation state, derived-state-from-props — re-check the live trigger list
fresh), `react-view-transitions` (page/element enter-exit animation, which
this explicitly is), `web-design-guidelines` (new user-visible UI/UX,
accessibility-relevant markup — check the WordCloud canvas's own
`role="img"`/dynamic-aria-label precedent and history of accessibility
findings for the pattern to match, or explicitly improve on if it was
itself found lacking), `composition-patterns` (new component prop API).
`code-review-graph` MCP as Step 0 (mandatory, not optional).

## 6. Fixtures

**[ALWAYS INCLUDE]**: `code-review-graph`'s `build_or_update_graph_tool()`
then `get_review_context_tool()`/`get_impact_radius_tool()` scoped to the
files in §2 Step 0, before any Grep/Glob/Read fallback.

**[FILL IN]**: Start from `main` (check `git log -1` for current tip before
starting). Look at `web/components/templates/console/__tests__/WordCloud.test.tsx`
(added by ADR 024) as the established RTL/happy-dom test pattern for a
canvas/interactive-visualization component in this codebase.

## 7. The three tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
>    contract for what you're building BEFORE writing it. After writing it,
>    check the diff against that stated contract — not "does it compile,"
>    but "does this actually fire on the real path it claims to fix."
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
>    passing unit test proving a function's isolated output is correct is
>    NOT sufficient evidence the fix works — trace the real caller chain
>    with actual proof. For THIS task specifically: a real browser
>    click-through showing the timeline animate open, markers appear at
>    correct positions, and playback actually bound-and-advance through
>    segments — not just a component-level unit test in isolation.
> 3. **Tangent hunt as you walk the workflow.** While touching each file,
>    check adjacent call sites and control-flow branches for the same class
>    of gap. Report tangents found even if not fixed this pass.
>
> **If you cannot complete a full cycle, or find a design gap mid-task,
> STOP and report the specific deviation and why, rather than shipping a
> partial fix under a "done" label.**

## 8. Report format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (cite actual command/query output, not
> "tests pass") → Tangents found → Deviations flagged (if any) → Skills run
> + findings → Gates (tsc/vitest/qa-intel `--ci --compare`/contract-auditor
> results, exact output) → Files changed. CC independently re-verifies every
> claim against real code and real system state before accepting — a report
> claiming "done" without this structure, or without E2E proof, will be
> rejected and sent back.

## 9. Gates — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # THE EXACT CI FLAGS
pnpm tsx web/scripts/contract-auditor.ts
```
