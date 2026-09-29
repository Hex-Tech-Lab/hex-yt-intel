# Agent Dispatch Prompt — R0 Stopgaps (disable Retry Missing + isolate Layer 2 WIP)

**Target Agent**: OC (opencode) — model `glm-preset/@preset/glm-53-flash-on-cheap` (user server-side preset, Modal-first — CLAUDE.md "OC model standard" v4)
**Effort Level**: low

Source: CC 96-hour audit, https://claude.ai/artifact/Le3vAmQY4T5PZhWFFcpFNU — Findings 1 and 9.

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

1. `web/components/templates/console/AnalysisHistory.tsx` lines ~485-517 (`retryMissingDimensions`) POSTs `{url, analysisId, missingDimensions}` to `/api/analyses` with NO `forceRefresh`. `CreateAnalysisUseCase.execute` (web/lib/usecases/CreateAnalysisUseCase.ts ~118-130) runs `findCachedAnalysis` first; that function (web/lib/adapters/SupabaseAnalysisAdapter.ts ~94-134) deliberately accepts partial rows with content, so the server returns a `cache_hit` for the same partial row. The user sees the toast "Retrying N missing dimensions" and NOTHING is retried. This is live on main (merged in #360). The real fix is phase R2. R0 only stops the button from lying.
2. The main checkout at `/home/kellyb_dev/projects/hex-yt-intel` has ~25 modified + several untracked files from several agents/waves, including the uncommitted Layer 2 "epistemic schism" work (web/lib/config/synthesis.ts, web/hooks/useSSEStream.ts, worker/src/services/PromptBuilder.ts, worker/src/routes/analysis.ts, worker/src/ports/ReasoningEnginePort.ts, worker/src/__tests__/prompt-cache-request-shape.test.ts, web/lib/usecases/CreateAnalysisUseCase.ts). The audit found that work unsafe to ship as-is. It must not ride any merge until phase R1 lands.

## 2. Contract & Implementation Directives

Do these steps IN ORDER. Do not skip, reorder or combine them.

**Step 1 — Back up the dirty tree (NO destructive git commands).**
1.1. In the MAIN checkout run: `mkdir -p .memory/wip && git diff > .memory/wip/2026-09-29-dirty-tree.patch && git status --porcelain > .memory/wip/2026-09-29-dirty-tree.status`
1.2. Copy every untracked path listed by `git status --porcelain | grep '^??'` into `.memory/wip/2026-09-29-untracked/` (preserve relative paths). EXCLUDE `.memory/wip/` itself.
1.3. Verify: `git apply --check -R .memory/wip/2026-09-29-dirty-tree.patch` exits 0. Paste the output.
1.4. FORBIDDEN in the main checkout: `git stash`, `git checkout -- <file>`, `git reset`, `git clean`, `git restore`. Other agents' uncommitted work lives there. Leave the working tree byte-for-byte as it is.
1.5. Do NOT commit anything under `.memory/wip/`.

**Step 2 — Isolated worktree for the stopgap.**
2.1. `git fetch origin && git worktree add ../hex-yt-intel-r0 -b fix/r0-retry-missing-stopgap origin/main`
2.2. Run `pnpm install --frozen-lockfile` in the worktree. ALL remaining steps happen in `../hex-yt-intel-r0` only.

**Step 3 — Disable the button (contract below).**
Contract: INPUT a `HistoryOverviewItem` with `status === 'partial'` and `missingDimensions.length > 0`. OUTPUT the "Retry Missing (N)" button renders with the attribute `disabled`, `aria-disabled="true"`, and a tooltip with EXACTLY this text: `Retrying missing sections is temporarily unavailable. Open the analysis to view the finished sections.` Clicking it makes ZERO network requests and shows no toast. Every other history row action is unchanged.
3.1. Open `web/components/templates/console/AnalysisHistory.tsx`. Find the Retry Missing button (near the line containing `item.status === 'partial' && item.missingDimensions.length > 0`).
3.2. Add `disabled` + `aria-disabled="true"` + the tooltip. Use the SAME tooltip mechanism other disabled controls in this file or its siblings already use (grep this file and `web/components/templates/console/` for `title=` / `Tooltip` first and copy that pattern). Do not invent a new tooltip component. A plain `title` attribute on a wrapping `<span>` is acceptable if nothing else exists. Disabled buttons don't fire hover events in some browsers, which is why the title goes on a wrapper.
3.3. Guard the handler as well: first line of `retryMissingDimensions` becomes an early `return;` with a one-line comment `// R0 stopgap (audit 2026-09-29 finding 1): server returns cache_hit for partial rows; real fix in R2.` Leave the rest of the function body in place. R2 rewires it.
3.4. Change NOTHING else. No formatting changes, no refactors.

**Step 4 — Test.**
4.1. Find the existing test for this component: `ls web/components/templates/console/__tests__/ | grep -i history`.
4.2. Add ONE test: render a partial item with `missingDimensions: [3, 9]`, assert that the button is disabled and has the exact tooltip text, click it, and assert that `fetch` was NOT called (spy on `global.fetch`).
4.3. NEGATIVE CONTROL: temporarily remove `disabled` + the early return, run the test, confirm it FAILS, paste the failure, then restore.

**Step 5 — Gates (paste real output for each).**
```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run components/templates/console
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
```

**Step 6 — Commit + PR (do NOT merge).**
6.1. `git add` ONLY the component and its test file. Commit message: `fix(history): disable Retry Missing until selective retry lands (R0 stopgap)`, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
6.2. `git push -u origin fix/r0-retry-missing-stopgap` then `gh pr create --base main --title "fix(history): R0 stopgap — disable Retry Missing" --body <RCA from section 1 + gates output + negative-control output>`.
6.3. STOP after the PR is open. CC verifies and owns the merge.

**Step 7 — Ledger isolation note.** Append to the MAIN checkout's `.memory/AGENT_LEDGER.md`:
`[NOTE] Layer 2 WIP is QUARANTINED — do not commit synthesis.ts / useSSEStream.ts / PromptBuilder.ts / worker analysis.ts / ReasoningEnginePort.ts / prompt-cache-request-shape.test.ts / CreateAnalysisUseCase.ts from the main checkout. Backup: .memory/wip/2026-09-29-dirty-tree.patch. Rework happens in phase R1 (worktree).`

## 3. Pre-PR Review Skills (matched to touched files)

- STEP 0: `build-graph`, then `get_impact_radius_tool` on `AnalysisHistory.tsx`.
- ALWAYS: `qa-intel` (`--mode diff` AND `--mode full`), `code-reviewer`, `review-delta`.
- FE (`web/components/**`): `react-best-practices`, `web-design-guidelines` (disabled-state a11y, tooltip reachable by keyboard).

## 4a. Verification & Quality Gates (local)

See Step 5. All must exit 0.

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

Scoped checklist for THIS task:
1. Contract = Step 3's input→output text. Enforce it with Step 4's test.
2. E2E: click → handler → (no) fetch → (no) toast. Prove it with the fetch spy.
3. Tangents: list every OTHER caller of `retryMissingDimensions` or other UI that POSTs `missingDimensions` (grep). Report them; do not fix them.

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

Also include: the backup file paths + sizes, the `git apply --check -R` output, and the PR URL.
