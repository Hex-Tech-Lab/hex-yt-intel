# Task Batch: Logs Console Bugs, History Desync, Error Banner Color, FM "Coming Alive" Motion

Dispatched to AGY 2026-07-28. Multiple independent bugs plus a motion-design task — treat
each numbered task as separately verifiable, don't batch-claim "all done."

## Context: two things already fixed by the orchestrator, don't redo

- `worker/src/services/LLMCascade.ts` had an undeclared `finishReason` variable —
  `ReferenceError` on every stream chunk once a `finish_reason` field arrived, crashing
  every synthesis stream in production. Fixed and deployed directly (`44fc3037`,
  committed as `e8fd9354`). **`pnpm run typecheck` inside `worker/` catches this
  instantly — it was never run on the change that introduced it, only `web`'s typecheck
  was checked despite the change being entirely in `worker/src`. Run the worker
  typecheck specifically for anything touching `worker/src` from now on, not just web's.**
- Confirmed and left as a known gap, not fixed yet: even after the crash fix,
  `finishReason` is captured on `LLMCascade`'s private per-attempt method but the public
  method `ReasoningEngine`/`PersistService` actually call
  (`Promise<{ started: boolean; finalText: string; modelUsed: string }>`) doesn't return
  it — so it never reaches the Sentry context that was Task 4's whole point. **Task 1
  below is finishing this properly.**

## Task 1 — Finish wiring finishReason end-to-end (Task 4 from the prior batch was incomplete)

Propagate `finishReason` from `LLMCascade`'s inner streaming method up through the
public method's return type, through `ReasoningEngine`, to wherever
`PersistService.extractJsonPayload(options.finalText)` is called (currently called with
only one argument at both call sites in `PersistService.ts:50` and `:168` — needs the
second `finishReason` argument). Proof required: trigger or find a real JSON-parse
failure and show the resulting Sentry event actually has a non-`'unknown'` `finishReason`
in its context.

## Task 2 — Logs console: copy button, filter, and two 503s are all broken

User-verified via live production testing (not code review):

1. **Copy-all shows wrong counts.** Copied output claimed `0` events for Vercel and
   others, but the same tabs, viewed directly, show real log lines (Vercel deployment
   history was populated). The copy function isn't reading the same data the tab
   displays — find where `getTabLogContent`/copy logic diverges from render logic.
2. **Time-range filter doesn't filter.** With "Last 1 Hr" selected, the Vercel tab
   returned log entries spanning at least back to `2026-07-26` (multiple days of
   deployment history), not the last hour. Check whether `range=1h` is actually being
   applied server-side in `/api/admin/logs/vercel/route.ts`, or just accepted and
   ignored. Verify every tab's range param is actually honored, not just Vercel's.
3. **Two live 503s, captured directly from browser devtools**:
   `GET /api/admin/logs/supabase?range=1h` → `503`, `GET /api/admin/logs/cloudflare?range=1h`
   → `503`. Root-cause each — likely the still-unresolved Vercel-prod-env-var gap for
   `SUPABASE_ACCESS_TOKEN`/`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` (the
   orchestrator added `VERCEL_TOKEN`/`VERCEL_PROJECT_ID`/`CLOUDFLARE_ACCOUNT_ID` to
   Vercel prod already; `SUPABASE_ACCESS_TOKEN` and the actual `CLOUDFLARE_API_TOKEN`
   bearer value still need to be generated fresh in each dashboard and added — nobody
   has done this yet). If that's confirmed the cause, say so plainly and stop — this one
   isn't a code fix, it's a "user needs to add two more secrets" blocker, don't build
   around it.
4. Proof required per sub-item: actual before/after captured output, not a description
   of the fix.

## Task 3 — Analysis History and Synthesis Console disagree on completion state

User-observed, real screenshots: Analysis History's top "Last Analyzed" card for the
Seafood Pasta video shows **`8/11 dims`**, while the same analysis inside the Synthesis
Console shows **all dimensions green/complete**. Also, the history list entry for the
*same* analysis elsewhere shows **`11/11 dims`**. Three different completion counts for
one analysis in three places. Find the single source of truth for "how many dimensions
does this analysis have" and make every surface read from it — don't let History compute
it one way and the Console compute it another. This is likely related to the
`MIN_USABLE_DIMENSIONS`/`isReceived || hasContent` logic already in
`DashboardContainer.tsx` (~line 373) diverging from whatever query populates the History
list — check both paths.

Also: History cards show "**Dim.0**" as a label with no further explanation. Confirm
what this is actually meant to communicate (presumably "Dimension 0 / Executive Digest is
available") and either make the label self-explanatory or add a tooltip (using the
already-migrated `Tooltip` primitive, not native `title`) — don't leave a bare "Dim.0" a
user has to guess at.

## Task 4 — Error banner needs a real warning treatment, not subdued gray

The synthesis-failure log line (`[ERROR] [synthesis:FAILED] ... valid=false`) currently
renders in the same muted gray as everything else in the log viewer, despite being a
critical failure state directly relevant to a video the user is actively viewing in the
console (8/11 dims, with the failure explaining the gap). Use the design system's
existing `--warn: #F59E0B` token (`web/app/globals.css:136`) — do not invent a new color.
Apply a glow-rim treatment consistent with the existing `.hx-glow` pattern already used
elsewhere in the app (search for `.hx-glow` usage as the reference, don't build a new
glow mechanism). This applies wherever synthesis failure/partial-completion state is
shown to the user in-context (not just the raw log line) — the Synthesis Console itself
should surface a visible warning when an analysis it's displaying is known-incomplete,
not just show it buried in a separate Logs tab the user has to go find.

## Task 5 — FM "coming alive" motion pass (framer-motion only, no new dependency)

Decision made: **keep Framer Motion, don't add GSAP** (paid tier, $0 budget) or a second
lighter library for mobile (added complexity for marginal bundle savings, not worth it —
one framework, one mental model). This task is scoped to what FM can already deliver.

User's own words for the target feel: *"the text header on top sliding to top as the url
input box slides up... the chat drawer animated opening and closing... the right panel
flyout actually flying in from left... the menus animate rather than simply exist...
the settings drawer slides up, etc — coming alive."* Explicitly **not** asking for the
full landing-page-style "wow effect" redesign of the Synthesis Console right now — that's
deferred to pre-launch polish, tracked separately, don't scope-creep into it here.

Concrete, bounded targets for this pass:
1. Header/URL input box: when a video is loaded and the header state changes (title
   appears, moves position), animate the transition with FM rather than a hard cut —
   find the actual component (likely in `DashboardContainer.tsx` or `AnalysisHero.tsx`)
   where this state change happens.
2. Chat drawer (`ChatDock.tsx`) open/close: already has `<ViewTransition>` wiring from
   an earlier task — confirm whether that's actually producing visible motion when
   driven in a real browser (a live question from an earlier round: was code-present/
   zero-visible-effect ever actually resolved, or does this need FM instead of/alongside
   `<ViewTransition>`). If `<ViewTransition>` isn't visibly working, use FM's
   `AnimatePresence` + slide/scale variants for the drawer instead — don't stack two
   competing animation systems on the same element.
3. Right panel flyout: should visibly fly in from the left edge, not just appear —
   FM `initial`/`animate`/`exit` with an `x` transform, mirroring the `fadeUp`/entrance
   pattern already established on the landing page for visual consistency.
4. Nav menus (left panel, Settings tree once it exists): items/panels should animate
   in rather than exist — again, reuse the landing page's existing FM variant patterns
   (`AnimatePresence`, staggered children) rather than inventing a new choreography
   language for the console.
5. Proof required: a driven-browser recording showing at least the chat drawer and one
   other target (right panel flyout or nav menu) actually animating, not a code diff.

## Non-negotiable process requirements (same as every prior batch)

1. **Run `worker`'s own `pnpm run typecheck` for any change touching `worker/src`** —
   this is now a hard requirement after Task 1's incident, not optional.
2. qa-intel output pasted in the report for every file touched, per the standing mandate.
3. Every "done" claim needs an attached, checkable artifact.
4. If something referenced here doesn't exist as described, say so and describe what you
   found instead before proceeding.
