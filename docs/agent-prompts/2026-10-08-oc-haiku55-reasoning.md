# Agent Dispatch Prompt — Haiku 5.5 allowlist + per-stream reasoning (feat/haiku-5-5-upgrade)

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

Worktree **/home/kellyb_dev/projects/hex-yt-intel-wt-haiku55**, branch `feat/haiku-5-5-upgrade` (from main 03c50a5f). Work only here; NEVER `cd` (use `pnpm --dir` / `--filter`); scratch files only under /home/kellyb_dev/projects/hex-yt-intel-wt-haiku55/.scratch/; NEVER `git stash`.

Production state (CC-verified 2026-10-08): the live Settings Registry `cascade.analysis` value (setting_values + setting_definitions default) and `app_settings.model_config` were ALREADY switched from `anthropic/claude-haiku-4.5` to `anthropic/claude-haiku-5.5` (same provider pins: google-vertex, azure, anthropic, amazon-bedrock — all serve 5.5 on OpenRouter). The code has not caught up:
- `web/lib/config/cascade.ts` `MODEL_CAPABILITIES` (~line 133) only lists haiku-4.5 → 5.5 tiers lose `tokenCapKey:'haiku'` (8192-token output cap → falls to 16000 default) and `requiresProviderOrder`.
- `CASCADE_MODEL_ALLOWLIST` is derived from `CASCADE_FALLBACKS` (~line 58-61 still 4.5) → admin save of `cascade.analysis` now REJECTS the live value.
- `worker/src/services/LLMCascade.ts` hardcodes `reasoning: { effort: 'low' }` for EVERY call (~lines 428 and 621).
- `isProjectiveBundle(dims)` (web/lib/config/synthesis) already distinguishes projective bundles; used in PromptBuilder.ts:130 and routes/analysis.ts.

## 2. Directives (in order)

### Task 1 — Haiku 5.5 in code
1. Step 0: code-review-graph for MODEL_CAPABILITIES / CASCADE_FALLBACKS / CASCADE_MODEL_ALLOWLIST callers and tests.
2. Add `'anthropic/claude-haiku-5.5': { tokenCapKey: 'haiku', requiresProviderOrder: true }` to MODEL_CAPABILITIES (keep 4.5 for rollback).
3. Change the `CASCADE_FALLBACKS` Haiku tiers to 5.5 (model + display name "Claude Haiku 5.5 (...)") so code fallback matches the live registry and the allowlist accepts 5.5. Keep 4.5 accepted too ONLY if some test/registry path still needs it — report your decision.
4. Grep the repo for any other `claude-haiku-4.5` / `claude-haiku-4-5` literal (e.g. web/lib/config/synthesis-with-settings.ts:55) and report each; change only ones that are live model routing, not historical docs/tests fixtures.
5. Check for any DB enum/CHECK constraint on model IDs (supabase/migrations). If none exists, say so — do NOT invent a migration.

### Task 2 — Per-stream reasoning effort
6. Trace how a stream's bundle (grounded vs projective, via isProjectiveBundle) reaches LLMCascade. Add a per-call reasoning option: grounded/deterministic streams → reasoning disabled (OpenRouter: `reasoning: { enabled: false }` — verify the exact OpenRouter param shape with Context7/OpenRouter docs before using it); projective + combiner streams → `{ effort: 'low' }`.
7. No hardcoded tunables (QualityEngine rule): make the two values Settings Registry keys following the EXACT existing pattern of a recent `analysis.*` setting (e.g. supabase/migrations/20261002090000_jev_max_parallel_streams_setting.sql + how it is read web-side and forwarded to the worker). Keys: `analysis.reasoning.grounded` (default `"none"`) and `analysis.reasoning.projective` (default `"low"`). New migration file: name it with a NEW timestamp later than 20261005020000; do NOT apply it (CC applies per ADR 018). If the registry→worker forwarding path makes this disproportionately large, STOP after Task 1 + a code-constant implementation and report why.
8. Tests: Task 1 — haiku-5.5 resolves with tokenCapKey 'haiku' (8192 cap) and passes the allowlist; Task 2 — grounded call body has reasoning disabled, projective has effort low. Negative control for each.

### Out of scope
YouTube iframe (already shipped in c31d8986), DB writes, pushing.

## 4a. Gates (paste tails)
```bash
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --dir web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
```
Commit on `feat/haiku-5-5-upgrade` (explicit paths only), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push.

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
