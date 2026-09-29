# Agent Dispatch Prompt — R4: UI state hydration + wire the history Retry button

**Target Agent**: OC (opencode) — model `glm-preset/@preset/glm-53-flash-on-cheap` (CLAUDE.md "OC model standard" v4)
**Effort Level**: medium

**Hard rules — MANDATORY:**
- The ONLY valid home path is `/home/kellyb_dev` (UNDERSCORE); any other spelling kills your run.
- Work ONLY in `/home/kellyb_dev/projects/hex-yt-intel-r4` (step 1). Never touch the main checkout except appending to its `.memory/AGENT_LEDGER.md`. Never read `~/.claude`.
- NEVER `git stash` / `git reset` / `git checkout -- <file>` / `git clean`. Never source `.env*`. No `supabase` CLI.
- NEVER delete or weaken an existing test; name every assertion you update because the contract changed.
- NO gate-gaming: no empty `finally`, no rewrites to dodge rules, no drive-by edits, NEVER edit `scripts/quality-engine/**` or `.qa-intel/baseline.json`. Pre-existing finding in a touched file: list it and STOP; CC decides. Run qa-intel AFTER `git add`.
- WRITE CODE EARLY: the map below is complete. If you have made no edit after 10 commands, you are stalling. Previous OC runs today stalled for 20 minutes of reading and were killed.
- Do not stop to ask questions and do not declare done early. Finish through the commit.
- Paste `git status --short` + `git diff --stat` before committing. Web route tests go in `web/lib/__tests__/` (app/api tests are allowlisted per route in vitest.config.ts and would never run).

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

## 1. Context (all premises CC-verified on main 3d56b059)

**T1 — refresh flicker (audit finding 10).** `web/components/containers/DashboardContainer.tsx` ~lines 249-265: a mount `useEffect` reads `?v=` and corrects the input-store URL. But `useAutoRestoreAnalysis(url)` (line ~265) runs in the SAME commit with the stale persisted URL (the input store persists via `safeStateLocalStorage`, `web/store/useInputStore.ts`), so a restore starts for the wrong video and is then cancelled. Lines ~304-315 mirror the active video into `?v=` with `history.replaceState`; keep that.
**T2 — Retry button.** `web/components/templates/console/AnalysisHistory.tsx`: the "Retry Missing (N)" button is disabled by the R0 stopgap (`disabled`, `aria-disabled`, a `title`, and an early return guard `const r0Stopgap = { enabled: true }` in `retryMissingDimensions`). The backend now exists (PR #367): `POST /api/analyses/[id]/retry`, body `{ missingDimensions?: number[] }` (omitted = all missing; `[]` = nothing). It runs remediation INSIDE the request (maxDuration 300s) and returns when done. Responses: 200 `{status, dimensionsRequested, dimensionCountAfter}` or `{status:'nothing_missing'}`; 401; 404; 409 `{error: in_progress|cancelled|ineligible|retry_in_progress}`; 429 `budget_exhausted`; 503 `disabled`; 400.
**T3 — #360 review items.** (a) The dashboard's `partialInfo` memo reports dimensions missing while the analysis is still streaming (`status === 'analyzing'`). (b) The `AnalysisStatus` union has both `partial` and `incomplete`, but the WIP/highlights/retry gates check only `partial`. (c) The AnalysisHistory WIP card heading/badge says "Analysis complete"/"Complete" for partial rows.

## 2. Contract & steps (IN ORDER)

1. `git -C /home/kellyb_dev/projects/hex-yt-intel fetch origin && git -C /home/kellyb_dev/projects/hex-yt-intel worktree add /home/kellyb_dev/projects/hex-yt-intel-r4 -b fix/r4-ui-hydration origin/main && cd /home/kellyb_dev/projects/hex-yt-intel-r4 && pnpm install --frozen-lockfile`
2. **T1 contract: the FIRST render already has the `?v=` video.** In `useInputStore`'s persist config, apply `?v=` during hydration (`onRehydrateStorage` / `merge`): if `window.location.search` has `v` and it differs from the persisted URL's video id, the hydrated state's `url` becomes `https://www.youtube.com/watch?v=<v>`. Then DELETE the mount-precedence effect in DashboardContainer (~249-263). KEEP the replaceState mirror. Test (hooks or store `__tests__`): persisted URL = video B, location `?v=A` → the store's first hydrated url is A, and `useAutoRestoreAnalysis` is never called with B (spy/mock).
3. **T2 contract.** Remove the R0 stopgap (the guard, `disabled`, and the stopgap title). The button POSTs `/api/analyses/${item.analysisId}/retry` with `{ missingDimensions: item.missingDimensions }`. It shows a busy state ("Retrying…"), awaits the response, then calls the existing `refetchHistoryOverview()`. On 200, toast `Recovered N section(s)` (use `dimensionCountAfter`/`dimensionsRequested`) or `Nothing left to retry`. Map 409/429/503/404 to plain-language toasts (e.g. 429 → "Retry budget is used up for now — try again later"; 503 → "Retries are paused"). Keyboard: Enter/Space on the button must NOT bubble to the row's `onKeyDown` restore (stopPropagation in the button's onKeyDown too). Clicking the icon or text must not trigger the row's `onSelectAnalysis`. Tests: fetch called with the right URL/body; each status → its toast; keyboard Enter → exactly one retry and no restore; the button is enabled for partial rows. UPDATE the R0 test that asserted "disabled + no fetch" (name it in the report: its contract deliberately changed).
4. **T3.** (a) `partialInfo`: no missing-dimension warning while status is `analyzing`; unchanged for terminal partial. (b) Handle `incomplete` exactly like `partial` in the WIP/highlights/retry gates; grep `=== 'partial'` in `web/components` and `web/hooks` and list every site in the report. (c) The WIP card heading/badge is status-aware: partial/incomplete → "Partially complete"; complete keeps its current labels. One test each.
5. Gates (paste real output, all exit 0): web tsc; web vitest (full); web lint; `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare` after `git add`.
6. NEGATIVE CONTROL: restore the old mount effect and remove the hydration merge; the T1 test must FAIL; restore.
7. Commit `fix(ui): R4 — ?v= applied at store hydration, Retry wired to /retry, partial-state UI fixes` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push. STOP and report.

## 3. Pre-PR Review Skills
- STEP 0: `build-graph`; `get_impact_radius_tool` on `useInputStore`, `useAutoRestoreAnalysis`, `AnalysisHistory`.
- ALWAYS: `qa-intel` (both modes), `code-reviewer`, `review-delta`.
- FE: `react-best-practices` (hydration, effects), `web-design-guidelines` (button states, keyboard).

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

Scoped checklist:
1. Contract = T1/T2/T3 above, each enforced by a test.
2. E2E: refresh with ?v=A over a persisted B → first render A → restore(A) only. Click Retry → POST → response → history row updated.
3. Tangents: other consumers of the persisted input URL; other places that POST analyses for retries (there should be none left).

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
