# Agent Dispatch Prompt — PR #442 review round 1 (phase-c UI wave)

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

## 1. Context

Worktree /home/kellyb_dev/projects/hex-yt-intel-wt-10x, branch `phase-c`, HEAD 157cb05b, PR #442. CI Lint (QualityEngine) FAILS: any new/changed finding in a touched file fails. CC has VERIFIED every item below against the current code — fix exactly these, nothing else. LAUNCH RULE: never `cd` outside this worktree (a rejected command ends your run); use `pnpm --dir web ...` or `(cd web && ...)` only.

## 2. Fixes (do in order; one commit per numbered group is fine)

1. **Revert ChatDock.tsx to its state at commit 5b0a5a90** (`git checkout 5b0a5a90 -- web/components/templates/console/ChatDock.tsx`), then fix any test that relied on the T3 ChatDock change. Reason: Cubic P2 (non-timestamp links lost ChatDock's own fallback) + it removes 17 pre-existing QE findings from the diff.
2. **Revert the parity-review wiring** (commit 3eb84500: `git revert --no-edit 3eb84500`). Reason: Cubic P2 — /admin/parity-review mounts no VideoPlayerCard, so seek buttons are dead.
3. **dimensionMarkdownComponents.tsx (~line 45-50)**: the seek target MUST come from the href seconds only. Use the rendered text only as the visible label. Add a test: `[1:23](#t=30)` seeks to 30. Also rename single-letter vars `n`,`h`,`m`,`s` (QE) — e.g. `hours`, `minutes`, `secs`.
4. **TimestampLink.tsx**: in the `asButton` branch REMOVE `onKeyDown` (native button activation; Cubic P3 — Space must fire on keyup and be cancellable). Keep the anchor branch unchanged. Update tests that simulated keydown on the button to use click.
5. **useHighlightsStatus.ts**:
   a. Effect A guard (`if (foundForAnalysisIdRef.current === analysisId) return;`) only valid if the CURRENT `result` belongs to that id. Fix A→B→A: when switching back to A while B was in flight, A must refetch (or keep a per-id cache Map<id, result>). Test: A found → switch to B (pending) → back to A → A's badge is restored (not null).
   b. Effect B (digestLoading true→false) must return early unless `status === 'complete'`; add `status` to its deps WITHOUT adding cleanup (no abort). Test: digestLoading true→false while status='analyzing' → no fetch.
6. **useDashboardLayout.ts / DashboardLayout.tsx**:
   a. Right panel default must match the old 390px at 1440px → 27%. DEFAULT_LAYOUT['3col'] = {sidebar:18, right:27} (center 55). Reset sink already derives from DEFAULT_LAYOUT — keep it that way; update any defaultSize props and tests.
   b. Shape change (2col↔3col): sizes from the previous shape must never be used. Key the sizes state by shape (e.g. `{shape, sizes}` and ignore when shape mismatches) or remount the Group with `key={shape}`. Test: persisted 3col layout restored after 2col→3col switch.
   c. QE: every catch in useDashboardLayout.ts must call `console.error('[DashboardLayout]', error)` DIRECTLY inside the catch (the scanner does not recognise the `reportError` helper). Delete `reportError` if unused afterwards.
   d. QE: rename single-letter `r` vars in web/lib/hooks/__tests__/useDashboardLayout.hydration.test.ts.
7. **YouTubePlayerAdapter.ts**: the 2 catch blocks QE flags (look for catches without console.error — e.g. the `console.debug` one in onReady's destroy race) → use `console.error('[YouTubePlayerAdapter]', ...)`; rename `e` → `event`/`error`, `_` → a descriptive name.
8. **TopBar.tsx**: rename the 2 single-letter `e` params.
9. **cors.ts (Cubic P2: log flooding from attacker-controlled Origin)**: in `isTrustedProductionOrigin`, return false BEFORE the try when `!URL.canParse(origin)` (check the worker's TS lib supports URL.canParse; if not, use a cheap `/^https?:\/\/[^\s/]+$/i` pre-check). Keep the catch WITH its console.error (QE requires it) — it becomes unreachable for malformed input. Add a cors test: malformed origin → null and console.error NOT called.

## 3. Out of scope
Ledger timestamp nits (CC handles), Codacy, ChatDock refactors, anything else → report only.

## 4a. Gates (paste tails) — all must pass
```bash
NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --dir web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --mode diff   # must show ZERO findings in any file you touched
```
Commit on `phase-c` with trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push.

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
