# Agent Dispatch Prompt — fix-qa-intel-warnings

**Target Agent**: AGY-2 (Flash 3.7)
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
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

## 1. Context

We recently merged `fix/harden-contract-boundaries` which fixed schema validation gaps. After running `qa-intel`, it reported two low-severity linting/quality warnings. We want to clear these up to keep our baseline at zero warnings.

## 2. Task

Fix the two findings reported by `qa-intel`:
1. `web/lib/adapters/PaddleBillingAdapter.ts`: Import `@sentry/nextjs` (framework) comes after thirdparty. Reorganize imports to follow the correct order groups.
2. `web/lib/validators/synthesis.ts`: Single-letter variable `v` outside of loop context is unclear. Rename to a descriptive name.

## 3. Goal / definition of done

`qa-intel --ci --compare` reports 0 issues. The imports in `PaddleBillingAdapter.ts` comply with our strict import sorting rule (Framework/lib -> Third-party -> Internal -> Types). The variable `v` in `synthesis.ts` has a descriptive name.

## 4. Expected results

Updated files:
- `web/lib/adapters/PaddleBillingAdapter.ts`
- `web/lib/validators/synthesis.ts`
A clean exit 0 run of the quality gates.

## 5. Task-specific skills/tools/plugins/MCPs

- CORE skills: `qa-intel`, `contract-auditor`, `/simplify`.
- SELECT skills: none specific.
- Tools: standard file reading/editing.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Before touching any code, run the project's
`code-review-graph` MCP tools (`build_or_update_graph_tool` first, then
`get_review_context_tool`/`get_impact_radius_tool` scoped to the files this
task touches) — this project's CLAUDE.md mandates this as Step 0, before
Grep/Glob/Read, for token efficiency and blast-radius awareness. Never skip
straight to file reads.

**Start state**: Ensure you are checked out to a new branch off `main` to perform these fixes.

## 7. The three tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
>    contract for what you're building BEFORE writing it. After writing it,
>    check the diff against that stated contract — not "does it compile,"
>    but "does this actually fire on the real path it claims to fix."
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
>    passing unit test proving a function's isolated output is correct is
>    NOT sufficient evidence the fix works — trace the real caller chain
>    with actual proof (a live DB query showing a row landed, a real HTTP
>    round-trip, not a mock standing in for the whole chain).
> 3. **Tangent hunt as you walk the workflow.** While touching each file,
>    check adjacent call sites and control-flow branches for the same class
>    of gap. Report tangents found even if not fixed this pass.
>
> **If you cannot complete a full cycle, or find a design gap mid-task,
> STOP and report the specific deviation and why, rather than shipping a
> partial fix under a "done" label.** A clearly flagged incomplete item is
> fine; a silently incomplete one reported as done is not — this project's
> history has multiple confirmed incidents of exactly that pattern.

## 8. Report format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (cite actual command/query output, not
> "tests pass") → Tangents found → Deviations flagged (if any) → Skills run
> + findings → Gates (tsc/vitest/qa-intel `--ci --compare`/contract-auditor
> results, exact output) → Files changed. CC independently re-verifies every
> claim against real code and real system state before accepting — a report
> claiming "done" without this structure, or without E2E proof, will be
> rejected and sent back.

## 9. Gates — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' on output, empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # THE EXACT CI FLAGS — the bare default run has different exit-code behavior and will give a false pass
pnpm exec tsx web/scripts/contract-auditor.ts
```
