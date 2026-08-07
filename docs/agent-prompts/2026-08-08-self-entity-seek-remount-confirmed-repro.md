# Agent Dispatch — Entity-seek silently no-ops after Console→History→Console nav (CONFIRMED live repro)

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `CLAUDE.md` §2 "SHARED COMMUNICATION PROTOCOL" in full. Read
`.memory/AGENT_LEDGER.md` before touching any file. Post `[IN_PROGRESS]` with
intent + target files as your first action. Post `[DONE]`/`[PARTIAL]`/`[BLOCKED]`
with a real summary as your last action.

## 1. Context

hex-yt-intel Next.js/Zustand app. A prior dispatch (docs/agent-prompts/2026-08-07-self-entity-seek-nav-remount-regression.md)
investigated this same symptom via CODE TRACING ONLY (no live browser access
in its sandboxed worktree) and concluded "activeNav is local state, no
remount happens" — disproving its own H1/H2 hypotheses — then fixed a
different, real bug (API-sourced knowledge-graph nodes missing `dimension`,
merged as PR #217). **That conclusion was WRONG.** This session has now
LIVE-REPRODUCED the original symptom TWICE, reliably, against PR #217's own
deployed fix (i.e. after that fix, the original symptom still reproduces
identically), with concrete evidence contradicting "no remount happens":

**Confirmed repro sequence** (Vercel preview + production, real browser,
real Google-authenticated session, real completed analysis
`jqvmORIAQjg`/video "Patrick Winston — How to Speak"):
1. Load the analysis in Synthesis Console.
2. Manually click Play once (video facade → real YouTube iframe mounts,
   `VideoPlayerCard.tsx`'s local `interacted` state becomes `true`).
3. Enable "Entity Click Time-Seek" toggle.
4. Click a Word Cloud entity → **works correctly**, real seek to a distinct
   timestamp (verified twice with different words, "MIT" and "research",
   each landing on a visibly different video frame/caption).
5. Navigate to "Analysis History" in the left sidebar (`activeNav` state
   change, no route/URL change — this is a client-side view swap within
   `DashboardContainer`, not a Next.js page navigation).
6. Navigate back to "Synthesis Console" for the SAME analysis.
7. **Observed**: the video player has reset to its un-started facade state
   (thumbnail + play button) — `VideoPlayerCard`'s local `interacted` state
   is back to `false`. This is direct evidence the `VideoPlayerCard`
   component instance was actually unmounted and remounted by step 5→6,
   since `interacted` is local `useState` with no persistence — a "local
   state is preserved because DashboardContainer itself doesn't unmount"
   argument does NOT hold, because `VideoPlayerCard` is a CHILD conditionally
   rendered inside the `activeNav === 'console'` branch and DOES unmount
   when that branch is false.
8. Click a Word Cloud entity → **broken**: node gets selected (Insights
   sidebar updates to show its detail, node gets a highlight/selection
   style), but ZERO video response — no seek, no playback start, video
   stays frozen on the exact pre-nav paused frame.
9. Checked browser console (`read_console_messages`, unfiltered): **zero
   errors, zero warnings, zero relevant log lines** around the click.
10. Checked network requests (`read_network_requests`, filtered `/graph`):
    **zero requests** fired for `/api/analyses/[id]/graph` after step 6's
    return to console — meaning `useKnowledgeGraph`'s API-fetch effect did
    NOT re-run.
11. Repeated steps 5-8 a second time (fresh word, "research" instead of
    "MIT") — identical failure, fully reproducible, not a fluke.

**Baseline control**: without the nav round-trip (steps 5-6 skipped),
entity-seek works correctly and reliably on the exact same build/analysis —
confirmed both before AND after step 3's play-click, and confirmed on both
the PR #217 preview deployment and (separately, earlier this session)
production. The bug is SPECIFICALLY triggered by the Console→History→Console
navigation, not a general regression.

## 2. Task

**Step 1 — do NOT repeat the previous dispatch's mistake of code-tracing
only.** You have live browser tool access in this session context (Claude
in Chrome tools) — USE them to reproduce the exact 11-step sequence above
yourself against a real running instance (local dev server via `pnpm dev`,
or a fresh Vercel preview from a branch you push) before forming any
hypothesis. If you cannot get live browser access working, STOP and report
that limitation explicitly rather than falling back to code-only inference
and guessing — that is the exact failure mode that produced PR #217's
incomplete fix.

**Step 2 — root-cause using real runtime instrumentation.** Given evidence
point 9-10 above (zero errors, zero re-fetch), the most likely candidates,
in order of suspicion:
- `handleSelectNode` in `web/components/containers/DashboardContainer.tsx`
  IS being called (confirm this first — add a temporary `console.log` at
  its very first line, or use a debugger breakpoint) but its
  `entityTimeSeekEnabled` read via `useVideoStore.getState()` is somehow
  false at click time, even though the UI toggle visibly shows ON. This
  would mean either (a) two different store instances exist (module
  duplication — check for a `useVideoStore` re-export or a per-chunk bundle
  duplication issue given `next/dynamic` is used for the Word Cloud/graph
  components with `ssr:false`), or (b) the toggle's own state write isn't
  actually reaching the same store instance the click handler reads from
  after the remount.
- `graph.nodes` (from `useKnowledgeGraph(nucleusAnalysis?.id)`, called at
  the top of `DashboardContainer`) is empty/stale specifically after the
  nav round-trip DESPITE `DashboardContainer` itself not unmounting — check
  whether `useKnowledgeGraph`'s internal state resets on some OTHER
  dependency change tied to the nav (e.g. if `nucleusAnalysis?.id` briefly
  becomes `undefined`/changes reference during the `activeNav` switch, even
  momentarily, its effect could tear down and rebuild with lost data, or a
  race with `loadedFromApi` flips false without a new fetch actually being
  triggered due to a stale closure).
- `handleSelectNode` isn't being called AT ALL — the click is landing on
  something else (e.g. an overlay, a stale DOM node reference held by the
  Word Cloud's own canvas/SVG rendering that didn't get the fresh
  `onSelect` callback rewired after remount). Check whether `WordCloud.tsx`/
  `MindMap.tsx`/`KnowledgeGraphCanvas.tsx` hold any internal ref/callback
  that could go stale across a parent re-render without the component
  itself unmounting (a closure-over-old-props bug, not a full remount).

Use real `console.log`/breakpoint instrumentation during your live repro to
determine which of these (or something else) is actually happening — do not
guess from a single one and stop.

**Step 3 — fix the confirmed root cause.** Whatever it is, the fix must
make the CONFIRMED 11-step repro sequence above actually work: a real seek
after Console→History→Console→click.

## 3. Goal / definition of done

The exact 11-step repro sequence in section 1 results in a real, correct
video seek at step 8, not a silent no-op — verified by YOU, live, in a real
browser, not inferred from code reading. If you cannot get live browser
verification working in your environment, this task is NOT done — report
that explicitly as a blocker rather than shipping a code-only "fix."

## 4. Expected results

- Root cause identified with real runtime evidence (console logs/breakpoint
  output showing actual values during the live repro), not code-reading
  inference alone.
- Fix in the actual root-cause layer.
- A regression test IF the affected mechanism can be simulated in a unit/
  integration test without needing a real browser (e.g. if it's a store-
  duplication or effect-dependency bug, a Testing Library test can likely
  reproduce it). If the bug can ONLY be reproduced with real navigation/
  remount timing that a unit test can't simulate, say so explicitly rather
  than shipping a test that doesn't actually cover the fixed behavior.
- Live re-verification of the fix using the same 11-step sequence, with
  before/after evidence (screenshots or described DOM/network/console
  state) in your report.

## 5. Task-specific skills/tools/MCPs

`react-best-practices` skill, specifically `rerender-`/`client-` rule
categories (this is exactly the "stale closure across parent re-render" or
"effect re-run gap" class of bug). Claude-in-Chrome browser tools
(`tabs_context_mcp`, `navigate`, `computer`, `read_console_messages`,
`read_network_requests`) — load them via ToolSearch if deferred, this is a
core requirement for this specific task, not optional.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Run `code-review-graph` MCP's `build_or_update_graph_tool`
then `get_review_context_tool`/`get_impact_radius_tool` scoped to
`web/components/containers/DashboardContainer.tsx`,
`web/hooks/useKnowledgeGraph.ts`, `web/store/useVideoStore.ts`,
`web/components/templates/console/WordCloud.tsx`,
`web/components/templates/console/MindMap.tsx`,
`web/components/templates/console/KnowledgeGraphCanvas.tsx` before reading
full files.

**[FILL IN]**: Start from `main` (check `git log -1` first — PR #217 was
just merged, tip should include it). You will need a way to reach a live,
authenticated instance to reproduce this — either run `pnpm dev` locally
and use the Claude-in-Chrome tools against `localhost`, or push a throwaway
branch and get a Vercel preview URL, then ask the user (via your final
report, if you cannot proceed autonomously) to sign in once if session
auth is required — do not attempt to handle credentials yourself.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the exact input→output
   contract for what you're building BEFORE writing it.
2. **E2E cycle complete, input to output, across the ENTIRE chain.** For
   THIS task specifically: a passing unit test or a code-reading argument
   is explicitly NOT sufficient — this exact task was dispatched because
   the prior attempt did exactly that and shipped a fix that didn't work.
   Live browser re-verification of the 11-step repro is mandatory.
3. **Tangent hunt as you walk the workflow.** Check adjacent
   selection/callback wiring in the same component tree for the same class
   of stale-reference-across-remount gap.

If you cannot get live browser verification working, STOP and report that
specific blocker — do not fall back to shipping an unverified code change
under a "done" label.

## 8. Report format — [ALWAYS INCLUDE]

RCA (with real runtime evidence) → Contract → Fix → E2E proof (live repro
before/after, described concretely) → Tangents found → Deviations flagged
(if any) → Skills run + findings → Gates (exact output) → Files changed.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
```
