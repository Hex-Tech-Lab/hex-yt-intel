# Agent Dispatch Prompt — phase-c resizable panels (Task 4 of 5)

**Target Agent**: OC
**Effort Level**: medium

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

## 1. Context & Problem Statement

Worktree /home/kellyb_dev/projects/hex-yt-intel-wt-10x, branch `phase-c` (PR #442), HEAD clean. Requirement: Left sidebar, Center main, Right flyout all resizable on desktop, sizes persisted in localStorage, plus a "Reset Layout" icon button in the header (next to the existing close/copy buttons) that clears the key and snaps to defaults. Styling: Tailwind/Astryx ONLY — no imported CSS files (CLAUDE.md §5: Tailwind + @astryxdesign, NOT shadcn).

CC-verified facts:
- Layout: web/components/templates/console/DashboardLayout.tsx (177 lines). Line ~104: `grid ... grid-cols-1 xl:grid-cols-[260px_1fr_390px]` when `rightPanel` is set, else `xl:grid-cols-[260px_1fr]`. Below xl, sidebar and right panel are off-canvas DRAWERS (drawerBase, mobileNavOpen/mobileRightOpen, Escape handler, body scroll lock, `inert`). Single caller: web/components/containers/DashboardContainer.tsx:999.
- `react-resizable-panels` is NOT installed yet.

## 2. Directives (in order, literally)
1. `pnpm --filter @hex-yt-intel/web add react-resizable-panels`. Then read the INSTALLED version's own type definitions in node_modules (its API differs between majors — e.g. PanelGroup/Panel/PanelResizeHandle + `autoSaveId`/`onLayout` vs newer Group/Panel/Separator). Report the version and the exact API you used. Do not code from memory.
2. Desktop (xl+) ONLY: replace the xl grid columns with the panel group. Below xl, behavior must stay byte-for-byte identical (drawers, backdrop, Escape, scroll lock, inert). If one tree cannot serve both, render the panel group only at xl+ (matchMedia hook, SSR-safe default) and keep the existing tree for smaller screens.
3. Defaults must match today's proportions (260px / fluid / 390px at a typical 1440px viewport → express as percentages) with sensible min/max so no panel collapses to unusable. Center keeps `min-w-0`.
4. Persistence: one localStorage key PER layout shape (2-column vs 3-column, since rightPanel is optional) — e.g. `hex:layout:v1:3col` / `hex:layout:v1:2col`. All reads/writes wrapped in try/catch (private mode / quota) with `console.error('[DashboardLayout]', error)`; a corrupt value falls back to defaults. No hydration mismatch: first client render uses defaults or the library's SSR-safe mechanism.
5. Drag handles: Tailwind classes only (thin bar, `bg-[var(--line)]`, hover/active accent, `cursor-col-resize`), keyboard-accessible (library handles arrow keys — keep it), visible focus ring.
6. Reset button: find the header with the close/copy buttons (start from the `topbar` prop passed at DashboardContainer.tsx:999). Icon-only button with aria-label "Reset layout" and a title tooltip; reuse the icon set already used there. Clicking clears BOTH keys and applies defaults immediately (library imperative API, e.g. group ref setLayout) — no reload.
7. Tests (happy-dom + RTL): (a) saved layout restored from localStorage; (b) corrupt JSON → defaults, no throw; (c) Reset clears key + restores defaults; (d) below-xl renders the drawer tree. Negative control: break the restore read → (a) fails.
8. Scope: package.json/pnpm-lock, DashboardLayout.tsx, the topbar/header component, DashboardContainer.tsx only if a prop must be threaded, new hook file if needed, tests. Do not touch History chips (Task 5).

## 4a. Gates (paste tails)
```bash
NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @hex-yt-intel/web exec tsc --noEmit
cd web && pnpm exec vitest run components lib/hooks
pnpm --filter @hex-yt-intel/web lint
pnpm --filter @hex-yt-intel/web build
pnpm dlx tsx scripts/verify-quality-engine.ts --mode diff
```
Commit on `phase-c`: `feat(web): resizable persistent dashboard panels with reset`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push.

## 5. The 4 Development Tenets — Universal Executor DNA — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

Source: `docs/agent-prompts/UNIVERSAL_EXECUTOR_DNA.md` (keep both identical).

> ### THE 4 DEVELOPMENT TENETS (YOUR MANDATORY DNA)
> You are a 10X Executor Agent. You must rigidly adhere to these laws during this task:
> 1. **End-to-End (E2E) Workflow Traversal:** Never fix an isolated "site error." Trace the payload path backward to the input and forward to the database or DOM. Ensure no breaks exist across the timeline.
> 2. **Contract Definition & Enforcement:** Mismatched schemas across boundaries are fatal. Rigorously enforce typing, handle edge cases, and respect cryptographic provenance.
> 3. **Hunt Breakages & Tangents (WITHIN SCOPE ONLY):** While walking your E2E path, actively hunt for blind spots. **The Dispatch Prompt explicitly defines your scope.** If you find an issue outside this defined scope, DO NOT fix it. Report it and request clarification. Emergency out-of-scope fixes are strictly prohibited unless explicitly authorized by the Master Orchestrator (GCW) in the dispatch.
> 4. **Mandatory Skill Execution:** You MUST run your local verification skills. Do not return your report until you have executed `/refactor-safely` for AST mutations, and validated your work with `qa-intel`, local linters, and test suites.

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
