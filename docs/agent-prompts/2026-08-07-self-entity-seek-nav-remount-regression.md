# Agent Dispatch — Entity-click seek silently no-ops after nav-away-and-back

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `CLAUDE.md` §2 "SHARED COMMUNICATION PROTOCOL" in full. Read
`.memory/AGENT_LEDGER.md` before touching any file. Post `[IN_PROGRESS]` with
intent + target files as your first action. Post `[DONE]`/`[PARTIAL]`/`[BLOCKED]`
with a real summary as your last action.

## 1. Context

hex-yt-intel Next.js/Zustand app. Entity-click time-seek (clicking an entity
in the Knowledge Graph, Word Cloud, or Mind Map panels seeks the video to
that entity's mention timestamp) was live-verified working correctly this
session on a completed analysis (`jqvmORIAQjg`, video "Patrick Winston —
How to Speak") — two separate word-cloud clicks ("MIT", "research") each
produced a distinct, correct video seek, and a Knowledge Graph node click
also seeked correctly, all while the video had already been manually
started (played) once.

**Then, in the SAME browser tab/session, on the SAME analysis**: the user
navigated to "Analysis History" in the left sidebar, then back to
"Synthesis Console". After that navigation round-trip, the video player
reset to its un-started facade/thumbnail state (expected — this is a lazy
facade, see `VideoPlayerCard.tsx`'s `interacted` state gate). Clicking a
Word Cloud entity ("MIT") after that point produced **no seek and no
playback at all** — the node visibly got selected (highlighted border,
Insights sidebar updated to show its detail), but the video stayed frozen
on the exact same paused thumbnail frame. This reproduced cleanly and is a
real regression trigger, not a one-off.

## 2. Task

**Step 1 — reproduce and root-cause, do not guess.** Reproduce this exact
sequence locally or against a live analysis: (a) load a completed analysis
in the Synthesis Console, (b) manually click Play on the video facade once
so it actually mounts a real YouTube iframe, (c) enable "Entity Click
Time-Seek", (d) click a Word Cloud or Knowledge Graph entity and confirm it
seeks (should work — this is the already-verified-working case), (e)
navigate to "Analysis History" in the left sidebar, then back to "Synthesis
Console" for the SAME analysis, (f) click a different Word Cloud entity and
observe: does it seek, or silently no-op?

Trace the actual code path for `handleSelectNode` in
`web/components/containers/DashboardContainer.tsx` (around line 209-244).
It reads `graph.nodes` (from `useKnowledgeGraph(nucleusAnalysis?.id)`,
line ~178) and calls `findNearestEntityMention(node, dimContent, chapters, ...)`.
Two concrete hypotheses to check against the ACTUAL runtime state after the
nav round-trip (add temporary logging or use React DevTools / breakpoints,
don't just read the source and assume):

- **H1**: `graph.nodes` is empty or stale (`[]` or old analysis's nodes)
  after the nav-away-and-back remount, because `useKnowledgeGraph`'s
  fetch/regeneration effect doesn't correctly re-run or re-populate on
  remount for an analysis that's already been viewed once this session —
  this is the exact class of gap ADR 023
  (`docs/specs/ADR_023_CLIENT_SIDE_KNOWLEDGE_GRAPH_REGENERATION_2026-08-06.md`)
  already flagged as open/unresolved. If `graph.nodes.find((n) => n.id === id)`
  returns `undefined`, the whole `if (node) { ... }` block is skipped
  silently — no error, no seek, exactly the observed symptom.
- **H2**: `graph.nodes` is populated correctly, but
  `useAnalysisDimensionsStore.getState().getDimension(node.dimension)`
  returns `undefined` after the remount (dimension content store not
  re-hydrated), so `dimContent` is `undefined`, and
  `findNearestEntityMention` either returns `null` or the "race condition"
  retry-subscribe branch (lines ~222-238) fires but the dimension never
  actually arrives (because nothing is re-streaming it — this is a
  completed analysis being re-viewed, not a live stream), so the 15s
  timeout silently expires with no seek ever happening.

Determine which (H1, H2, both, or something else) is the actual cause with
real evidence (console logging showing actual values at each check point
during the repro, not inference from reading the code).

**Step 2 — fix the confirmed root cause.** Do not patch symptoms in
`VideoPlayerCard.tsx` (that component's logic is already correct per this
session's source read — the bug is upstream in the entity/graph data not
being available when `handleSelectNode` runs after a remount). If H1: fix
`useKnowledgeGraph`'s re-fetch/regeneration logic so navigating away and
back to an already-analyzed video reliably re-populates `graph.nodes`
before the user can interact with it (or block/disable entity-seek
interaction with a visible loading state until it's ready — do not let a
click silently no-op with zero feedback). If H2: fix
`useAnalysisDimensionsStore`'s hydration on remount for a completed
analysis being re-viewed (this store should have all dimension content
available immediately for a `status === 'complete'` analysis, not rely on
a live-stream race-condition retry path that only makes sense mid-generation).

## 3. Goal / definition of done

The exact repro sequence in Step 1 (play once → nav away → nav back →
click a different entity) results in a real, correct seek — not a silent
no-op. If a genuine loading window exists (e.g. graph regeneration takes a
moment), the UI must show that state, not silently swallow the click.

## 4. Expected results

- Root cause identified with real evidence (described above), not
  assumption.
- Fix in the actual root-cause layer (`useKnowledgeGraph.ts` and/or
  `useAnalysisDimensionsStore.ts` and/or `DashboardContainer.tsx`'s
  `handleSelectNode`), not a `VideoPlayerCard.tsx` patch.
- A regression test if the affected hook/store has an existing test file
  (check `web/hooks/__tests__/` and `web/lib/stores/__tests__/` or
  equivalent) — extend it to cover "remount after already having data,
  entity click still resolves a timestamp."
- If this turns out to BE the same root cause as ADR 023's already-flagged
  open item, update that ADR doc to note this session's additional repro
  and evidence rather than treating it as a brand-new separate issue.

## 5. Task-specific skills/tools/MCPs

`react-best-practices` skill (this is a React hook/store re-hydration bug
class — check `rerender-` and `client-` rule categories). `code-review-graph`
MCP for blast radius on `useKnowledgeGraph.ts`/`useAnalysisDimensionsStore.ts`.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Run `code-review-graph` MCP's `build_or_update_graph_tool`
then `get_review_context_tool`/`get_impact_radius_tool` scoped to
`web/hooks/useKnowledgeGraph.ts`, `web/lib/stores/analysis-dimensions-store.ts`
(or wherever `useAnalysisDimensionsStore` actually lives — verify exact
path via the graph tool, don't guess), and
`web/components/containers/DashboardContainer.tsx` before reading full files.

**[FILL IN]**: Start from `main` (clean tip as of dispatch — check
`git log -1` first, other agents may have landed commits). Read
`docs/specs/ADR_023_CLIENT_SIDE_KNOWLEDGE_GRAPH_REGENERATION_2026-08-06.md`
in full — it may already describe the exact mechanism you need to fix, or
may turn out to be a related-but-distinct gap; state explicitly which once
you've root-caused this.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the exact input→output
   contract for what you're building BEFORE writing it. After writing it,
   check the diff against that stated contract — not "does it compile,"
   but "does this actually fire on the real path it claims to fix."
2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
   passing unit test proving a function's isolated output is correct is
   NOT sufficient evidence the fix works — trace the real caller chain
   with actual proof. For THIS task specifically, that means actually
   reproducing the nav-away-and-back sequence and confirming a real seek
   happens after the fix, not just that a hook returns non-empty data in
   isolation.
3. **Tangent hunt as you walk the workflow.** While touching each file,
   check adjacent call sites and control-flow branches for the same class
   of gap. Report tangents found even if not fixed this pass.

If you cannot complete a full cycle, or find a design gap mid-task, STOP
and report the specific deviation and why, rather than shipping a partial
fix under a "done" label.

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (cite actual command/query output, not
"tests pass") → Tangents found → Deviations flagged (if any) → Skills run
+ findings → Gates (exact output) → Files changed.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
```
