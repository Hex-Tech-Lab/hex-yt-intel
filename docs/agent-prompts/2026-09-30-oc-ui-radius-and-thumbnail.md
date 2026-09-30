# Agent Dispatch Prompt — UI: system-wide 8px/6px radius, chat focus, header control heights, history thumbnail (mockup v2)

**Target Agent**: OC (`glm-preset/@preset/glm-53-flash-on-cheap`, CLAUDE.md "OC model standard")
**Effort Level**: medium
**Series**: standalone (Jev comment classification). Pilot evidence (CC, 2026-09-30): see §1.

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.
>
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

---

---

## HARD RULES

1. Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-ui` (branch `feat/ui-radius-thumbnail`, created by CC from `origin/main`). Home dir `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files. If the same test fails twice for the same reason, STOP and report `[BLOCKED]`.
3. No live-DB writes, no migration apply, no deploys, no secrets printed. CC applies migrations (ADR 018).
4. qa-intel findings are NOT advisory (CI fails on them). Fix new-code findings; never baseline new code.
5. Commit when done (no push). Paste `git status --short` first: only the files named below.
6. Negative control for EVERY behavioural test you add: revert the fix → the test fails; paste the output. A test that passes without the fix proves nothing.

---

## 1. Context & Problem Statement

User-approved design (2026-09-30). Stack: Tailwind v4 + Astryx, NOT shadcn. Radii are centralised in `web/app/globals.css`: a first `@theme` block defines `--radius-control/card/pill` and `--radius-xs…3xl`, then a later **"Sprint 1" `@theme` block overrides every one of them to `0px`** (~L82–97) — that override is why everything became right-angled.

Target (user's words, condensed):
- **8px** on every panel/card/control rectangle: history rows and the history panel, video player card, highlights reel and every rectangle inside it (ticker, summarizer, navigation buttons, timeline), synthesis panel, Dimension 0 (snapshot, overview, key takeaways, detailed summary, and its outer control border), the 11 dimension cards, right-hand panel (word cloud and each cloud inside it, insights, knowledge graph, mind map and its inner control), history search bar and dropdowns, header search, Simple/Pro mode selector, history pagination buttons, chat box and chat message input.
- **6px** on small elements under ~24px tall (chips, badges, status pills, tiny icon buttons) so they don't look like pills.
- `rounded-full` stays ONLY on genuinely circular things (status dots, avatars, spinners) — list each one you keep.
- **Dimension cards look "cut off" at the corners**: find why (likely an inner element/border/background with a different or zero radius, or `overflow` clipping a child that has its own radius) and make inner and outer radii agree (inner = outer − border/padding where nested).
- **Header: the search control is taller than the Simple/Pro selector** → make both the SHORTER height.
- **Chat input: remove the cyan accent focus ring.** Keep an accessible focus state: on focus the border only brightens slightly (use an existing neutral token, not the accent), same 8px shape, never a square outline. The chat box's own rounding is "too much" → 8px.
- **History thumbnail**: implement `docs/agent-prompts/2026-09-30-history-thumbnail-mockup-v2.html` (open it and read its CSS): the image is one layer BELOW the row content, pinned right with a 4px margin, full row height at 16:9; to the left of the vertical divider it keeps going and fades out via `mask-image: linear-gradient(to left, #000 calc(100% - var(--fade)), transparent)` over **2.5cm**; the divider is drawn ON TOP of the image; title and chips are on the top layer with a light `text-shadow` (0 1px 2px rgb(0 0 0 / .65)) and may run over the faded part. Current code: `web/components/templates/console/AnalysisHistory.tsx` ~L944–956 (`HistoryThumbnail` inside a `w-28 sm:w-36 md:w-44` bordered box). The fade length is a CSS custom property, not a magic number in JSX.

## 2. Contract & Implementation Directives

1. Ledger `[IN_PROGRESS]`. `build-graph`; find every radius source: the two `@theme` blocks, `tailwind.config.ts`, any hardcoded `rounded-[..px]`, `rounded-none`, inline `borderRadius`, and Astryx theme radius variables. Paste the inventory.
2. Replace the "Sprint 1" 0px override block with the new scale (single source of truth): `--radius-control: 8px; --radius-card: 8px; --radius-pill: 6px; --radius-xs: 4px; --radius-sm: 6px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 8px; --radius-2xl: 8px; --radius-3xl: 8px;` (check Tailwind v4's mapping of bare `rounded` and set its token too). Update the header comment to say what this is and why (user decision 2026-09-30). If Astryx has its own radius variables, point them at these tokens.
3. Fix components that bypass the tokens (hardcoded px radii, `rounded-none` on rectangles the user listed, inline styles) so they resolve from the scale; chips/badges use the 6px token.
4. Dimension-card corner clipping: RCA + fix (say exactly which element caused it).
5. Header heights, chat focus, chat box radius, thumbnail — as specified in §1.
6. Tests: a `web/lib/__tests__/radius-tokens.test.ts` that parses `globals.css` and asserts the LAST `@theme` value of each radius token (8/6 scale; fails if any token is 0px — negative control: restore the 0px block → fails). A render test for the thumbnail (`web/components/templates/console/__tests__/`): image layer, divider and text layer exist in the right stacking order (z-index / DOM order) and the fade uses the CSS variable.
7. Visual check: run the app (`run` skill or `pnpm --filter @hex-yt-intel/web dev`) and take screenshots of dashboard (light + dark if both exist), history list, chat, and highlights reel; list each screenshot path in the report. Do not claim a visual result you did not screenshot.
8. Gates, qa-intel after `git add`, commit `feat(ui): 8px/6px radius system, chat focus, header heights, history thumbnail fade`, ledger `[DONE]`.

Out of scope: colour/palette changes, layout changes other than the thumbnail and the header height alignment.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

Use `docs/agent-prompts/TEMPLATE.md` §3 verbatim (newest list). Re-match SELECT whenever the touched-file set grows. Write "not available in OC" for any skill you cannot invoke — never claim it ran.

---

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```
---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
