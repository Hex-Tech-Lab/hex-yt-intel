# Agent Dispatch Prompt — Highlights-Reel Design Overhaul

Dispatched to: OC (opencode / DeepSeek, low effort)

## 0. Ledger protocol — [ALWAYS INCLUDE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

## 1. Context

hex-yt-intel is a Next.js/Cloudflare Worker/Supabase YouTube video-intelligence SaaS, Tailwind + Astryx design system (`@astryxdesign/core`, `@astryxdesign/theme-neutral`) **exclusively** — NOT shadcn/ui (shadcn was fully removed 2026-08-02, confirmed dead, zero real imports). The highlights-reel feature (dashboard, `web/components/dashboard/HighlightsScrubber.tsx` + `web/components/dashboard/HighlightsTrack.tsx`) was redesigned earlier tonight (2026-08-20, PR #258) and its playback engine extracted/fixed across PRs #262/#263/#264 — all of that is functionally correct as of this dispatch (PR #264 fixes the last known functional bug: Play button deadlock). This dispatch is VISUAL/UX ONLY — do not touch playback logic, `useSegmentPlayback.ts`, or `useHighlightTicker.ts`.

The user gave direct, blunt live feedback on a real screenshot tonight (2026-08-20 ~23:56): *"the design like the old. no segments and the totals are 14m out of 15... this is messed up and the design is terrible and not even related to the design system... i am fed up."* Clarified afterward: this is about **functional and unappealing design, not just unfashionable** — i.e., the current implementation reads as broken/generic, not merely a taste mismatch.

Current implementation (`HighlightsScrubber.tsx`) uses raw Tailwind utility classes (`className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[var(--border-muted)]"`, a plain native `<select>` for speed) rather than Astryx components/tokens for most of its layout — this is very likely why it reads as "not even related to the design system." Astryx's `Button`/`Spinner` are used, but the container chrome, spacing, and the speed selector are not idiomatic Astryx.

Also flagged by the user's screenshot: "9 keypoints · 14m40s of 15m39s (94%)" — nearly the ENTIRE video is selected as "highlights," which defeats the purpose of a highlights reel. This may be a genuine product/algorithm issue (the uncapped-selection change from PR #258 selecting too aggressively), not purely visual — **investigate and report on this, but do not silently change the selection algorithm** (`GenerateExecutiveDigestUseCase.extractHighlights`, `highlights.maxCount` Settings Registry key) as part of a design-only dispatch. Flag it as a tangent finding for CC to decide on separately.

## 2. Task

Redesign the VISUAL PRESENTATION of `HighlightsScrubber.tsx` and `HighlightsTrack.tsx` (dashboard, authenticated) to be genuinely polished and consistent with the Astryx design system — not a cosmetic tweak, a real craft pass. Apply the installed `impeccable` skill's audit → redesign → live-iterate workflow, informed by `ui-ux-pro-max`'s design-intelligence reference (color/typography/spacing/UX-guideline database) for concrete decisions. **Do NOT use `ui-styling`'s shadcn/ui component recommendations or install shadcn** — that skill's shadcn defaults directly conflict with this project's frozen Astryx-only stack; if you invoke it at all, use only its stack-agnostic Tailwind/accessibility guidance, never its component library suggestions.

Concretely, at minimum:
1. Replace raw ad-hoc Tailwind chrome (`rounded-xl`, `border`, `bg-[var(--surface)]`) with actual Astryx components/tokens wherever an equivalent exists (check `Card`, `Select`/`Dropdown` primitives in `@astryxdesign/core` before assuming none exists — grep `node_modules/.pnpm/@astryxdesign+core*/node_modules/@astryxdesign/core/src` for the real component catalog, don't guess from memory).
2. Fix the plain native `<select>` for speed (line ~189 of `HighlightsScrubber.tsx`) to use an actual Astryx select/dropdown component if one exists.
3. Improve `HighlightsTrack.tsx`'s marker-track visual design — the user's screenshot shows a thin flat bar with small dots; make this feel intentional and polished, matching Astryx's visual language (check other timeline/progress-bar-like Astryx components for the established pattern, e.g. any `Progress`/`Slider` primitive).
4. Live-iterate: use Playwright (already available in this repo's toolchain) to actually render the component in a real browser and visually verify before/after, not just code-review the diff. `impeccable`'s own live-iteration capability should drive this — don't skip it.

## 3. Goal / definition of done

A live Playwright screenshot of the redesigned `HighlightsScrubber` (rendered against real highlight data, at least 2 highlights) showing: Astryx-idiomatic container chrome (not raw Tailwind bg/border classes duplicating what an Astryx `Card` or equivalent already provides), an Astryx-styled speed control (not a native `<select>`), and a visually polished marker track — captured as a real screenshot file, not asserted. A second agent (or the user) should be able to look at the before/after screenshots and see an obvious, real quality improvement, not a marginal tweak.

## 4. Expected results

- Modified: `web/components/dashboard/HighlightsScrubber.tsx`, `web/components/dashboard/HighlightsTrack.tsx` (visual/JSX/className changes only — no changes to `useSegmentPlayback`, `useHighlightTicker`, or any state/logic).
- New: before/after Playwright screenshots saved somewhere reportable (e.g. `.claude/worktrees/<this-worktree>/screenshots/` or similar — reference the exact path in your report).
- A short written finding (in your `[DONE]` report, not a new doc) on the "94% duration selected" tangent — is it a real selection-algorithm issue or working-as-designed given the uncapped-selection change? Do not fix it, just report.
- `.memory/AGENT_LEDGER.md` entries: `[IN_PROGRESS]` and final `[DONE]`/`[PARTIAL]`/`[BLOCKED]`.

## 5. Task-specific skills/tools/plugins/MCPs

Beyond CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets:
- `impeccable` — primary skill for this task, use its full audit → redesign → live-iterate workflow.
- `ui-ux-pro-max` — design-intelligence reference for concrete color/spacing/typography decisions, stack-agnostic parts only.
- `web-design-guidelines` — SELECT trigger (user-visible UI/UX/accessibility change) per this repo's `pr-review-workflow` skill.
- `react-best-practices` — SELECT trigger (React component changes).
- **Explicitly do NOT invoke**: `ui-styling`'s shadcn component recommendations (conflicts with frozen Astryx-only stack).
- Playwright (via this repo's existing browser-testing setup) for live-iteration and before/after screenshot capture — required, not optional, per `impeccable`'s own workflow and this task's Goal section above.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Before touching any code, run the project's `code-review-graph` MCP tools (`build_or_update_graph_tool` first, then `get_review_context_tool`/`get_impact_radius_tool` scoped to `web/components/dashboard/HighlightsScrubber.tsx`, `web/components/dashboard/HighlightsTrack.tsx`) — this project's CLAUDE.md mandates this as Step 0, before Grep/Glob/Read.

**[FILL IN]**: Start from current `main` (PR #264, the Play-button-deadlock fix, is open but not yet merged as of this dispatch — check `gh pr view 264 --json state` and rebase onto it if merged by the time you start, since your visual changes will otherwise conflict). Read the real Astryx component catalog directly from `node_modules/.pnpm/@astryxdesign+core*/node_modules/@astryxdesign/core/src/` (do not guess component names from memory — this project's CLAUDE.md explicitly warns against exactly that class of mistake). Read `web/lib/utils/highlights-settings.ts` for existing design tokens/constants already in use (`HIGHLIGHTS_SPEED_MIN`/`MAX`, `fmtHighlightsDuration`) so the redesign doesn't duplicate them.

## 7. The three tenets — [ALWAYS INCLUDE]

> 1. **Contract definition + enforcement.** State the exact input→output
>    contract for what you're building BEFORE writing it. After writing it,
>    check the diff against that stated contract — not "does it compile,"
>    but "does this actually fire on the real path it claims to fix." For
>    THIS task: the "contract" is that all existing props/behavior
>    (playingIdx, jumpTo, start/stop, speed) are visually re-skinned, never
>    functionally altered.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
>    passing unit test proving a function's isolated output is correct is
>    NOT sufficient evidence the fix works — trace the real caller chain
>    with actual proof. For THIS task specifically: a live Playwright
>    screenshot IS the E2E proof — code-review confidence alone is
>    explicitly insufficient for a visual/design task.
> 3. **Tangent hunt as you walk the workflow.** While touching each file,
>    check adjacent call sites and control-flow branches for the same class
>    of gap. Report tangents found even if not fixed this pass (the 94%
>    duration-selected observation from section 1 counts as one).
>
> **If you cannot complete a full cycle, or find a design gap mid-task,
> STOP and report the specific deviation and why, rather than shipping a
> partial fix under a "done" label.**

## 8. Report format — [ALWAYS INCLUDE]

> RCA → Contract → Fix → E2E proof (cite actual command/query output, not
> "tests pass") → Tangents found → Deviations flagged (if any) → Skills run
> + findings → Gates (tsc/vitest/qa-intel `--ci --compare`/contract-auditor
> results, exact output) → Files changed. CC independently re-verifies every
> claim against real code and real system state before accepting — a report
> claiming "done" without this structure, or without E2E proof (real
> screenshots for this task), will be rejected and sent back.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
```
