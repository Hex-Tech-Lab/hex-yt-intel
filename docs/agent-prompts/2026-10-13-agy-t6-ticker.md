# Agent Dispatch Prompt — T6 highlights-reel ticker follows speech

**Target Agent**: AGY (gemini-3.8-flash-low)
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

## Working directory and tooling

- Your worktree is `/home/kellyb_dev/projects/hex-yt-intel-wt-t6-ticker`, branch `fix/highlights-ticker-t6`, cut from `origin/uat`. Work ONLY there. Do not touch `~/projects/hex-yt-intel-wt-ux-motion`, `~/projects/hex-yt-intel-wt-t5-reel`, or `~/projects/hex-yt-intel-wt-ticker` (branch `fix/ticker-pace`, read-only reference at most).
- Package manager is `pnpm` only. Never use npm.
- **Code lookups use code-review-graph MCP tools ONLY (`semantic_search_nodes_tool`, `query_graph_tool`, `get_impact_radius_tool`, `get_review_context_tool`). Do NOT use grep, rg, or find to search code.** The graph is already built for this worktree at SHA 8ee93799. If a graph query returns empty or stale, run `build_or_update_graph_tool` first, then query again. Plain file Read is allowed only after the graph has named the file.
- Do not stash. Do not use `git stash` in any form.

## 1. Context & Problem Statement

<Context>

The highlights reel has a word-by-word "karaoke" ticker under the reel. Owner report: the ticker runs at its own pace. It keeps moving while the speaker pauses, gets ahead of the voice, and then the voice catches up. Required behaviour: the ticker must FOLLOW THE SPOKEN WORDS. It advances only on word timings and holds during silences. No free-running timer.

Known starting points (verify, do not trust blindly):
- The reveal logic is `useHighlightTicker` in `web/lib/hooks/useHighlightTicker.ts`. It is a pure function of `elapsedSeconds`, `speakingSeconds`, `verbatimExcerpt`, `label`, `wordsPerSecond`, `leadInSeconds`. It has no timer of its own. `revealPace` derives a per-segment pace as words / speakingSeconds, clamped to [1.5, 6] words/s, and falls back to the registry `wordsPerSecond` (default 2.5) for paraphrased labels.
- `elapsedSeconds` comes from the caller's media-time poll (`useSegmentPlayback` or the store). Find the caller(s) with the graph (`query_graph_tool` pattern `callers_of` / `importers_of` on the hook, and `semantic_search_nodes_tool` for the reel/scrubber components). Check whether any caller runs its own `setInterval`, `requestAnimationFrame` or 250ms advance-poller that drives the ticker separately from real playback time.
- The transcript may carry per-word timings: YouTube json3 captions carry word offsets (`tOffsetMs`). Check, through the graph, whether the stored highlight/transcript rows keep per-word or only per-segment timestamps (`analysis_highlights`, `transcripts`, the worker transcript shape). Record exactly what is stored.
- A branch `fix/ticker-pace` (commits 8f8bea8f, 05b6544c, 27413f80, not merged to uat) already touches this same hook. Read its diff for reference only with `git show` or `git diff origin/uat fix/ticker-pace -- web/lib/hooks/useHighlightTicker.ts`. Do not cherry-pick or merge it. Report what it does that uat lacks.

Scope limits:
- Only the ticker path: the hook, its direct callers that feed it time, and their tests.
- Do NOT change the Simple/Pro switch, play/seek scroll behaviour, reel layout, highlight selection, or any worker/prompt code. Those belong to T5 and other tasks.
- If any file you need to change is also being changed by T5 (branch `fix/highlights-reel-t5`), STOP and report `[BLOCKED]` with the file names. Do not proceed.

</Context>

## 2. Contract & Implementation Directives

<Directives>

**Step 1 — REPORT ONLY. Make no code edits in this step.**

1.1 Post your `[IN_PROGRESS]` ledger line (see §0).
1.2 Use the graph to list every caller of `useHighlightTicker` and the component(s) that supply `elapsedSeconds`. Name each file and line.
1.3 For each supplier of `elapsedSeconds`, state its source (store time, `requestAnimationFrame`, `setInterval`, poll interval, clamp rules). Say whether it can advance while the media is paused or silent.
1.4 State whether the stored data has per-word timings. Name the column or JSON key. If only segment timings exist, say so explicitly.
1.5 Name one existing maintained library for caption/word sync if one fits (must be MIT or Apache-2.0, stable, and actively maintained). Give its name, version, licence, and whether it fits our data (segment vs word timings). Compare it against fixing our own mapping. Recommend one. Do not install anything.
1.6 Summarise what `fix/ticker-pace` changes relative to uat.
1.7 Post `[PARTIAL]` in the ledger with the Step 1 findings. Then STOP and wait for CC's go-ahead. CC will reply in the ledger or via SendMessage.

**Step 2 — IMPLEMENT (only after CC approves Step 1).**

**APPROVED BY CC (2026-10-13), overriding the branch note above:** `fix/ticker-pace` was squash-merged as PR #469 (main `4a55a4f8`) and uat already contains that work. The current hook IS that work, and the owner still sees drift. IGNORE the `fix/ticker-pace` branch entirely; do not read it further.

2.1 Replace pace-based interpolation (`words / speakingSeconds`, the registry `wordsPerSecond` pace) with REAL timings from captions. Drive the reveal from the player's `currentTime`: the word whose caption timing has started is revealed, and the reveal holds on the last started word during silences. Use per-word timings (YouTube json3 `tOffsetMs` word offsets) where stored; otherwise use segment timings. Do not run a free timer. Do not advance on elapsed time that the captions do not account for. If no timings exist for a row, show the label without a timed reveal and say so in the report, rather than estimating a pace.
2.2 Keep the public hook signature stable where possible. If the signature must change, update every caller in the same commit and say so.
2.3 Add unit tests in the existing `web/lib/hooks/useHighlightTicker.test.ts` (or a sibling file). Cover at minimum: (a) advances only as time advances, (b) holds across a silence (elapsed flat), (c) does not run ahead of a word's own timing, (d) falls back to the registry pace when no timings exist, (e) a legacy row with no timings still renders.
2.4 Run a negative control: temporarily reintroduce the old free-running behaviour, confirm the new test fails, then restore.
2.5 Run the gates in §4a below. All must pass.
2.6 Open a PR against base `uat` (never `main`). Title: `fix(highlights): ticker follows speech timing, holds in silence (T6)`. Body includes the Step 1 findings summary and test output.

</Directives>

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

- **STEP 0 — before any code lookup**: code-review-graph only (see the Working directory section above). Do not use grep.
- **ALWAYS**: run `qa-intel` in both `--mode diff` and `--mode full`. Run the `simplify` skill on your diff. Run `code-reviewer` on your diff.
- **IF `web/components/**` | `web/hooks/**` | `web/lib/hooks/**` | `web/app/**`**: run `react-best-practices` (hook deps, stale closures, layout stability) and `web-design-guidelines`.
- Record every skill run and its findings under `### Skills Run + Findings` in the final report.

---

## 4a. Verification & Quality Gates (local)

```bash
pnpm install
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```

---

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
