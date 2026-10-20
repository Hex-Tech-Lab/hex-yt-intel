# Agent Dispatch Prompt — phase-c History chip legibility (Task 5 of 5)

**Target Agent**: OC
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
>
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

---

## 1. Context & Problem Statement

Worktree /home/kellyb_dev/projects/hex-yt-intel-wt-10x, branch `phase-c` (PR #442), HEAD clean. User report: in the Analysis History list, chip/title text DISAPPEARS (letters fade out) where it runs over the right-side background thumbnail.

Target outcome (CC interpretation of the user's two mission versions — follow exactly): TEXT stays fully crisp and legible everywhere; the elegant left-fade belongs to the THUMBNAIL bleeding into the card, not to the letters. Keep the user's 2026-09-30 "mockup v2" layering (thumbnail one layer below content, pinned right, fades left via `--hx-thumb-fade`; content z-10 with halo shadows) — see docs/agent-prompts/2026-09-30-history-thumbnail-mockup-v2.html.

CC-verified facts (web/components/templates/console/AnalysisHistory.tsx, 1037 lines):
- Lines ~145 and ~168: chip rows carry `[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent_100%)]` (+ -webkit-). A mask on the TEXT container is the prime suspect for "letters fading out" — confirm or refute.
- Line ~838: row-2 details `flex-nowrap overflow-hidden hx-halo`. Line ~817: content column `p-4 relative z-10 hx-thumb-content` (padding-right supposedly reserves the unfaded thumb width).
- Line ~975: `hx-thumb-layer absolute ... z-0` thumbnail. Classes hx-thumb-layer / hx-thumb-content / hx-halo / hx-chip-shadow / --hx-thumb-fade live in web/app/globals.css.

## 2. Directives (in order, literally)
1. Step 0: code-review-graph for AnalysisHistory consumers; read the globals.css rules for the hx-* classes above. Write the RCA: which rule makes letters vanish (mask on text? content padding vs thumb width? halo too weak?).
2. Fix: remove/relocate any mask that applies to TEXT; ensure the thumbnail layer carries the fade (`mask-image: linear-gradient(to right, transparent 0, black var(--hx-thumb-fade))` or the existing equivalent) so the image — not the text — fades. Overflowing text should truncate with an ellipsis or be clipped by layout, never faded by a mask. If legibility over the faded image still needs help, strengthen the existing halo/backdrop in globals.css (CSS custom props, no JSX magic numbers).
3. Do not change the layering, row structure, thumbnail size/position, or any other component.
4. Test: update/add a component test asserting the chip-row containers have NO mask-image class and the thumb layer keeps its fade class. Negative control: re-add the text mask → test fails.
5. Scope: AnalysisHistory.tsx, web/app/globals.css, their tests.

## 4a. Gates (paste tails)
```bash
NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @hex-yt-intel/web exec tsc --noEmit
cd web && pnpm exec vitest run components/templates
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --mode diff
```
Commit on `phase-c`: `fix(web): keep history chip text crisp, fade the thumbnail instead`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push.

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
