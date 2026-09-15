# Agent Dispatch Prompt — Right panel reserved-but-empty in Simple mode + WordCloud misplacement

**Target Agent**: OC (OpenCode, glm-5.3-flash)
**Effort Level**: low

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

---

## 1. Context & Problem Statement

Live user report (2026-09-07, screenshot confirmed): in the dashboard's
Simple view mode, the right-hand panel column renders as an empty allocated
space (no content, no controls) while the WordCloud component renders
underneath/inside the center column's flow instead of in that right panel.

Root cause, already confirmed via code investigation this session:

1. **Layout always reserves the column**: `web/components/templates/console/DashboardLayout.tsx:103-105`:
   ```tsx
   className={`grid ... grid-cols-1 ${
     rightPanel ? "xl:grid-cols-[260px_1fr_390px]" : "xl:grid-cols-[260px_1fr]"
   }`}
   ```
   This checks JS truthiness of the `rightPanel` **prop** (a JSX element),
   which is truthy even when that element renders nothing inside — so the
   390px column is allocated regardless of actual content.

2. **The empty-content path**: `web/components/containers/DashboardContainer.tsx:441-444` and `:866-881`:
   ```tsx
   const rightPanelItems = useMemo(
     () => effectiveViewMode === "simple" ? [] : [ ... ],
     ...
   );
   ...
   rightPanel={
     <AnimatePresence mode="wait">
       {rightPanelItems.length > 0 && ( ... <RightPanelAccordion items={rightPanelItems} /> ... )}
     </AnimatePresence>
   }
   ```
   In Simple mode, `rightPanelItems` is `[]`, so `AnimatePresence` renders no
   children — but the `rightPanel` prop passed to `DashboardLayout` (the
   `<AnimatePresence>` element itself) is still a truthy JSX element, so
   `DashboardLayout` still reserves the empty 390px column.

3. **WordCloud placement**: `web/components/containers/SimpleDashboardView.tsx:84-92`:
   ```tsx
   {status === "complete" && graph.nodes.length > 0 && (
     <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 h-[400px]">
       <WordCloud graph={graph} selectedId={selectedNodeId} onSelect={onSelectNode} />
     </div>
   )}
   ```
   In Simple mode, WordCloud is rendered inline in the center column's flow
   (under `AnalysisHero`), never in the right panel — so visually it appears
   "underneath the center panel" while the reserved-but-empty right panel
   sits beside it, which is exactly the reported bug.

## 2. Contract & Implementation Directives

**Contract**: in Simple mode, the layout must NOT reserve the 390px right
column when there is nothing to show in it. Either (a) the right column
collapses entirely when `rightPanelItems.length === 0`, matching the
already-correct `!rightPanel` fallback grid in `DashboardLayout.tsx`, or (b)
WordCloud is intentionally the Simple-mode right-panel content and should be
moved INTO the right panel column instead of the center column — pick
whichever matches the actual product intent, and if ambiguous, prefer (a)
(collapse empty column) since that's the narrower, safer fix, and flag the
WordCloud-placement question explicitly in your report for the user to
decide rather than guessing product intent.

**Implementation approach**:
1. Fix `DashboardContainer.tsx`'s `rightPanel` prop construction so it passes
   `null`/`undefined` (not a truthy-but-empty `<AnimatePresence>` element)
   when `rightPanelItems.length === 0`, e.g.:
   ```tsx
   rightPanel={
     rightPanelItems.length > 0 ? (
       <AnimatePresence mode="wait">
         ... <RightPanelAccordion items={rightPanelItems} /> ...
       </AnimatePresence>
     ) : null
   }
   ```
   Verify `DashboardLayout.tsx`'s `rightPanel ? ... : ...` check then
   correctly falls to the 2-column grid.
2. Do NOT move WordCloud's rendering location unless you also confirm (by
   reading how Pro mode's right panel/`RightPanelAccordion` renders WordCloud,
   if it does at all) that Simple mode is supposed to mirror that placement.
   If Pro mode never puts WordCloud in the right panel either, leave
   WordCloud's current center-column placement in `SimpleDashboardView.tsx`
   alone — the empty-column fix in step 1 alone resolves "right panel
   allocated but empty" without touching WordCloud's actual location.
3. Check for any other caller of `DashboardLayout` with the same
   truthy-empty-element pattern (grep `rightPanel=` across
   `web/components/containers/**`) — fix all instances, not just this one,
   per the "tangent hunt" tenet.

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

This touches `web/components/**` — run: `qa-intel` (both `--mode diff` and
`--mode full`), `code-reviewer`, `simplify`, `review-delta`,
`review-duplication`, `contract-auditor`, `react-best-practices`,
`composition-patterns`, `web-design-guidelines`.

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```
Run every command's exit code directly (redirect to a file, `echo "EXIT: $?"`
with NO pipe in between) — never trust `$?` after piping through `tail`/
`grep`/`head`.

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

Do NOT open a PR or push — commit locally on a new branch
`fix/right-panel-empty-simple-mode` and report back with the branch name and
diff summary for review before anything is pushed.
