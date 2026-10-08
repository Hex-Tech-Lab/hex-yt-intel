# Agent Dispatch Prompt — ARTAS v3 QualityEngine rules (Phase 2)

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

Worktree /home/kellyb_dev/projects/hex-yt-intel-wt-10x, branch `phase-c`. FIVE other OC runs are auditing PRs read-only in this same checkout right now — they only write `docs/reviews/artas-parts/*`. Therefore: **never `git add -A` / `git add .` / `git commit -a`; stage only the exact files you created/changed.** Never `cd` outside the worktree (a rejected command ends your run).

Read `.memory/ARTAS_REGISTRY.md` first. Add QualityEngine rules for the 4 vectors marked [QE]: V20, V10, V19, V05. Follow the existing convention exactly — study `scripts/quality-engine/rules/security-lessons-20260924.ts`, its test `rules/__tests__/security-lessons-20260924.test.ts`, its registration (rules/index.ts line ~58 + rules-registry.ts / DEFAULT_REGISTRY) and the registration test pattern (`*-registration.test.ts`).

## 2. Directives (in order)

1. Step 0: code-review-graph (`semantic_search_nodes_tool`) for how Rule/RuleContext/Finding are shaped and how an existing rule is registered. Report it.
2. Create `scripts/quality-engine/rules/artas-v3.ts` with four rules (names `artas-v20-unconsumed-stream`, `artas-v10-unbounded-body-read`, `artas-v19-non-idempotent-retry`, `artas-v05-fail-open-filter`), each with a docblock: vector, historical incident (from the registry), exact AST pattern, and accepted limitations.
   - **V20**: in a function that calls `fetch(`, an `if` on `!res.ok` / `res.status` whose branch returns or throws WITHOUT a prior `res.body?.cancel()` / `res.body.cancel()` / body consumption (`.text()`, `.json()`, `.arrayBuffer()`, `.blob()`) inside that branch. Severity medium.
   - **V10**: `.arrayBuffer()` on a response object with no byte-limit evidence earlier in the same function (a `content-length` header read compared to a number, or a reader loop with a byte counter). Severity medium. Do NOT flag reads of responses from hard-coded first-party URLs if trivially determinable; otherwise accept the hit.
   - **V19**: a loop (`for`/`while`/recursive retry) that calls `fetch(` in its body, inside a function with no reference to both `'GET'` and `'HEAD'` (method gate) and no `idempotency`/`Idempotency-Key` text. Severity high.
   - **V05**: Supabase/PostgREST filter calls `.eq|.neq|.in|.match|.filter|.contains(` whose value argument is an identifier/property access whose TypeScript type includes `undefined` or `null` (use the type checker if RuleContext exposes one; if it does not, fall back to: identifier is a parameter declared optional `?:` or typed `| undefined`), with no preceding `if (!x)`/`if (x == null)`/`x ??` guard in the same function. Severity high.
3. Tests `scripts/quality-engine/rules/__tests__/artas-v3.test.ts`: for EACH rule a positive-fire fixture and a negative-control fixture of the fixed shape (V20: branch with `await res.body?.cancel()`; V10: content-length check; V19: `if (method !== 'GET' && method !== 'HEAD') return fetch(...)`; V05: guarded value). Plus `artas-v3-registration.test.ts` asserting all four are in DEFAULT_REGISTRY.
4. Register in rules/index.ts and the registry exactly like the 20260924 rules.
5. Run the full scan and REPORT hits per new rule on the current codebase (file:line list) — this is audit input, do not fix product code:
   `NODE_OPTIONS=--max-old-space-size=8192 pnpm dlx tsx scripts/verify-quality-engine.ts --mode full > /tmp/... ` — if it still OOMs, run diff/working-tree mode and say so. If any rule fires > 25 times, look at 5 hits: if mostly false positives, tighten the pattern and re-run; report before/after counts.
6. Do NOT refresh the qa-intel baseline and do NOT touch product code. CC decides baseline handling.

## 4a. Gates (paste tails)
```bash
pnpm --dir web exec vitest run ../scripts/quality-engine/rules/__tests__/artas-v3.test.ts ../scripts/quality-engine/rules/__tests__/artas-v3-registration.test.ts
```
(If the scripts tests run under a different config, find how existing `security-lessons-20260924.test.ts` is run — e.g. root vitest — and use that.) Plus `pnpm exec tsc --noEmit -p scripts` or the repo's scripts typecheck if one exists. Negative control: break one rule's pattern → its positive test fails.
Commit ONLY your files: `feat(qa-intel): arm static analyzer with ARTAS v3 structural vectors`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push.

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
