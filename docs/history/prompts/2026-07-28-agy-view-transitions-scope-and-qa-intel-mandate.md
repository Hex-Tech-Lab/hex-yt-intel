# Task Batch: Extend View Transitions to the Actual Console Shell + qa-intel Is Now Mandatory

Dispatched to AGY 2026-07-28, follow-up to `d6bf96ca`/`399c5109`.

**Update after `273e33f6` landed** (Tasks 1/2/3 below executed — SettingsPanel/
ConsoleTabSwitcher/DashboardContainer wrapped in `<ViewTransition enter="fade-in"
exit="fade-out">`, qa-intel run with 1 finding fixed): two gaps remain, added as Task 4.
Don't redo Tasks 1-3, they're done and verified (grep-confirmed `<ViewTransition>` now
present in all three files, qa-intel output pasted in the report, typecheck clean).

## Context: two things already fixed by the orchestrator, don't redo

- `SettingsPanel.tsx`'s Activity & Usage pane was passing `{ user: null, analysesUsed: 42
  (hardcoded), ... }` into `BillingDashboardClient`, which does
  `initialData.user.id.slice(0,5)` for a referral code — crashed on the null user,
  producing a live 500. It was also fabricated data instead of real usage stats. Fixed in
  `399c5109`: replaced with a real client fetch of the already-existing
  `/api/usage/summary` endpoint (own-user-scoped, computes analyses/chat-turns/cost from
  `usage_logs` — this endpoint existed the whole time and was never called).
- Root cause of that bug landing at all: qa-intel wasn't run on this work across roughly
  six rounds of prompts in this session. See Task 3 below — this is now a hard
  requirement, not a courtesy line.

## Task 1 — View Transitions never actually reached the console shell

User's exact words: *"scroll and card motion on landing is fine, optimize later. but it
does not exist in console screen. not in the menus in the left panel or central or right
panel. nowhere to be seen."*

Verified via grep: `<ViewTransition>` (the actual React component, not just the
`startTransition` scheduling API) is used in exactly one place —
`ChatDock.tsx:397/636`, wrapping the chat dock's own panel content. Nothing wraps:
- The left-hand nav (dashboard tab switcher, and the new `SettingsPanel.tsx` tree nav)
- The central content pane's swaps (`SettingsPanel.tsx`'s `activeKey` switch between
  Overview/Logs/Usage/Preferences/Admin Registry; `ConsoleTabSwitcher.tsx`'s tab changes;
  `DashboardContainer.tsx`'s main view swaps)
- The right panel generally, outside ChatDock's own open/close

An earlier task ("Task G") was scoped to wrapping `setOpen`/`setHeightState` calls in
`startTransition` inside `ChatDock.tsx` specifically — it did that correctly, but that
was never the full ask; it just happened to be the only place View Transitions existed
already, so "wire it up" landed narrowly instead of extending coverage.

1. Wrap `SettingsPanel.tsx`'s content-pane swap (the `activeKey === '...'` conditional
   blocks) in `<ViewTransition>`, with the `setActiveKey` calls wrapped in
   `startTransition` (mirror the exact `ChatDock.tsx` pattern — import `ViewTransition`
   and `startTransition` from `react`, wrap the swapped content, wrap the state setter
   calls).
2. Do the same for `ConsoleTabSwitcher.tsx`'s tab-change path and
   `DashboardContainer.tsx`'s main view swap — find the actual state setters that change
   which view renders and wrap those specifically, not just the JSX.
3. Left-hand nav: the tree items in `SettingsPanel.tsx` and the main dashboard nav
   should get a transition on the active/selected indicator changing, not necessarily
   full-panel transitions — use judgment on what "motion in the left panel" should look
   like (a sliding/fading active-state indicator is reasonable), but don't skip it
   entirely.
4. Proof required: a driven-browser recording (gif or equivalent) showing a visible
   transition when switching Settings submenu entries, and one for the main dashboard
   tab switch. A code diff alone is not proof — this exact failure mode (code present,
   zero visible effect) is what happened with Task G the first time.

## Task 2 — Root-cause why View Transitions produced no visible effect the first time

Before just adding more `<ViewTransition>` wrappers, check whether the React version in
`web/package.json` and the Next.js config actually support `<ViewTransition>` in this
app's runtime (it's a relatively new/experimental API) and whether
`prefers-reduced-motion` or some global CSS is suppressing it. If Task G's ChatDock
wiring is *also* not visibly producing motion when driven in a real browser, the bug
isn't scope (Task 1) — it's that the mechanism itself isn't firing anywhere, which is a
different and more urgent problem. Check this first, report which case it is, and only
proceed with Task 1's expansion once confirmed the mechanism itself works.

## Task 3 — qa-intel is now mandatory, not optional, for every task in this file

Run `pnpm tsx scripts/verify-quality-engine.ts` and paste its actual output in your
report for every file you touch in this batch. If `--mode=working-tree` shows nothing
because your changes are already committed by the time you check, use `--mode=full` or
otherwise verify against the real diff — don't accept a clean result from a mode that
isn't actually scanning your changes. This is not a process-requirements footnote
anymore (see `docs/history/prompts/2026-07-28-agy-logs-observability-tooltip-stream4.md`
and follow-ups, all of which had this as a buried line item AGY never actually acted on)
— show the command you ran and its output, or the task is not done.

## Task 4 — Directional transitions, not one flat fade; scroll-triggered motion is a separate, unaddressed ask

What shipped in `273e33f6` is `enter="fade-in" exit="fade-out"` applied uniformly
everywhere. Two distinct gaps:

1. **No directional variety.** `ChatDock.tsx` already has the real pattern —
   `enter="slide-in-right" exit="slide-out-right"` — that was never extended to the new
   wrapping. Add direction logic: going deeper into a submenu (e.g. Settings Overview →
   System Logs) should slide/fly in from one side, returning to a parent (submenu →
   Overview) should reverse it, and any vertical tree movement should get an up/down
   variant, not the same side-slide. You'll need `::view-transition-old(...)`/
   `::view-transition-new(...)` keyframe classes for each direction (fade is already
   defined per the earlier report's CSS check at `globals.css:559-615` — add
   slide-up/slide-down/slide-left variants alongside the existing fade and
   `ChatDock`'s slide-right).
2. **RTL**: the user asked about LTR/RTL explicitly. Checked — **this app has no RTL
   handling anywhere** (`grep` for `dir="rtl"` / `direction: rtl` across
   `layout.tsx`/`globals.css` returns nothing). Before building direction-aware
   transitions, confirm with the user whether RTL support is actually in scope right
   now or just a naming-convention question — don't build a dual LTR/RTL transition
   system for an app with no RTL support elsewhere, that's solving a problem that
   doesn't exist yet. If it's just "name the transitions with direction in mind so RTL
   is easy to bolt on later," say so and build the LTR-only version with directional
   variants named generically (`slide-start`/`slide-end` rather than `slide-left`/
   `slide-right`) so flipping for RTL later is a CSS-only change.
3. **Scroll-triggered motion is not covered by any of this and cannot be** — React's
   `<ViewTransition>` fires on `startTransition`-wrapped state changes, not scroll
   position. It is architecturally a different mechanism from the landing page's
   `whileInView` (framer-motion, IntersectionObserver-driven). If scroll-triggered
   entrance animation inside the console (e.g., content animating in as the central pane
   scrolls) is wanted, that's a new, separate feature — say explicitly in your report
   that this task batch does not and cannot deliver it, don't imply the fade wiring
   covers it.
4. Proof required: a driven-browser recording showing at least two different transition
   directions firing for two different navigation actions (e.g. entering a submenu vs.
   returning to Overview), not just the single fade from before.

## Non-negotiable process requirements (same as every prior batch, now with qa-intel elevated per Task 3)

1. Every "done" claim needs an attached, checkable artifact.
2. End-to-end: verify by driving the actual UI, not by reading the code and asserting it
   should work — this exact gap (plausible code, zero real-world effect) has now
   recurred twice (Task G originally, and implicitly this whole file).
3. If something referenced here doesn't exist as described, say so and describe what you
   found instead before proceeding.
