# Agent Dispatch Prompt — <TASK_NAME>

**Target Agent**: <AGY-1 (Pro) | AGY-2 (Flash) | OC (OpenCode)>
**Effort Level**: <high | medium | low>

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
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

---

## 1. Context & Problem Statement

<Context>

---

## 2. Contract & Implementation Directives

<Directives>

---

## 3. Mandatory Pre-PR Review Skills Gate (ENFORCED)

> **STRICT RULE**: Before running CI commands or opening a PR, you MUST execute the applicable review skills below based on touched files. Do NOT skip this step. All skill executions and findings MUST be documented in your final report under `### Skills Run + Findings`.

### A. Universal Core (MANDATORY on EVERY task before commit/PR):
1. `/simplify`: Run AST and dead-code pruning across all modified files. Strip unused imports, abandoned bindings, and redundant conditionals.
2. `review-delta`: Inspect git diff against base branch. Confirm zero unintended diff noise, no stray console logs, and no transient scratch files.
3. `review-duplication`: Check for copy-paste clones and duplicated logic blocks to prevent CodeFactor clone regressions.
4. `contract-auditor`: Run `pnpm exec tsx web/scripts/contract-auditor.ts`.

### B. Domain-Specific (TRIGGERED BY TOUCHED FILES):
- **If React / UI files touched (`web/components/**`, `web/hooks/**`, `web/app/**`)**:
  - Run `/react-best-practices`: Audit hook dependencies, SSR hydration safety, singleton browser client usage, re-render loops, and layout stability.
- **If Webhooks / Auth / Billing / API routes touched (`web/lib/adapters/**`, `web/app/api/**`, `worker/src/routes/**`)**:
  - Run `/owasp-top-10`: Verify PII redaction in telemetry (Sentry), constant-time signature verification, null/whitespace injection tolerance, and auth boundary checks.
- **If Knowledge Graph / Stitching / SQLGraph touched (`web/lib/services/stitch*`, `worker/src/services/ZodSchemas*`, `synthesis*`)**:
  - Run `build-graph`: Validate topological sorting, referential integrity between node IDs and edge source/target endpoints, and POLE+O enum alignment.
- **Before PR Creation (Final Review Pass)**:
  - Run `code-reviewer` or `review-pr`: Perform an adversarial pre-flight review of the entire branch diff.

---

## 4. Verification & Quality Gates

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
