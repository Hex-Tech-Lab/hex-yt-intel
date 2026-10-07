# Agent Dispatch Prompt — phase-c QualityEngine unblock (Task 1 of 5)

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

Worktree: /home/kellyb_dev/projects/hex-yt-intel-wt-10x, branch `phase-c` (PR #442). Working tree is clean at e197d697.
CI/CD run 37615906693, job "Lint" (QualityEngine) FAILS with exactly these 7 findings (verified by CC from the job log):

1. worker/src/__tests__/error-handler-cors.test.ts — "Import ordering violated": 'hono' (thirdparty) after internal. Order must be framework → thirdparty → internal → types.
2. worker/src/middleware/cors.ts — "Auth: localhost fallback in production route" (rule in scripts/quality-engine/rules/security.ts).
3+4. worker/src/middleware/cors.ts — "Catch block without error logging" ×2 (the two bare `catch {}` at ~lines 42 and 78).
5. worker/src/middleware/cors.ts — "Unclear variable name 'c'" (corsMiddleware ~line 83).
6. worker/src/middleware/error-handler.ts — "Import ordering violated": '@sentry/cloudflare' comes after the `import type` line.
7. worker/src/middleware/error-handler.ts — "authorization-relevant change with no sibling test": no file named like error-handler.test.ts exists (only error-handler-cors.test.ts).
Also: error-handler.ts — "Unclear variable name 'c'".

## 2. Contract & Implementation Directives (do these steps in order, literally)

1. Read the rule in scripts/quality-engine/rules/security.ts that emits "localhost fallback" and find EXACTLY which text in cors.ts triggers it. Report the trigger.
2. Finding 2 — CONSTRAINT: `LOCAL_DEV_ORIGINS` is NOT an APP_URL fallback; it is the dev allowlist. Do NOT break local dev CORS and do NOT redirect anything. Correct fix direction: make localhost trust prod-gated (e.g. resolveCorsOrigin only accepts LOCAL_DEV_ORIGINS when not production, matching isValidAppUrl's existing `isProd` handling) and update every caller (worker.ts, chat-stream.ts, error-handler.ts, routes/analysis.ts). If the rule still fires on a correct, fail-closed implementation, STOP and report it as a rule false positive — do not contort code or add suppressions.
3. Findings 3+4 — in each catch, bind the error and log it: `console.error('[CORS]', error)` and keep returning false.
4. Finding 5 + error-handler 'c' — rename `c` to `ctx` in those two functions only.
5. Findings 1 and 6 — reorder imports only; no other edits in those lines.
6. Finding 7 — `git mv worker/src/__tests__/error-handler-cors.test.ts worker/src/__tests__/error-handler.test.ts` (keep its content), so the sibling-test rule is satisfied.
7. Add/adjust tests in worker/src/__tests__/cors.test.ts for the prod-gating from step 2 (localhost rejected in prod, accepted in dev). Negative control: revert the gating, confirm the new test fails, re-apply.
8. Scope: ONLY the files above (+ the 4 caller files if the signature changes). No other files. Do not touch web/.

## 4a. Gates (run all, paste output tails)
```bash
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter youtube-intelligence-worker exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm dlx tsx scripts/verify-quality-engine.ts --mode full
```
Commit on `phase-c`: `fix(worker): resolve quality engine blockers in cors + error-handler` with trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push — CC verifies and pushes.

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
