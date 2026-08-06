# Agent Dispatch Prompt — Template

Use this for EVERY agent dispatch in this project — OC, AGY, a remote/worktree
Agent-tool call, or a prompt CC writes for itself before starting a task. Copy
this file, fill in the bracketed sections, save as
`docs/agent-prompts/<date>-<agent>-<short-task-name>.md`, then dispatch.

The sections marked **[ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]** are
copy-pasted verbatim, every time, no exceptions. They exist because every one
of them was skipped at least once this project's history, and each skip
caused a real, verified incident (see the citations inline). The sections
marked **[FILL IN]** are the actual per-task content — this is where the
real work of writing a good prompt lives; don't leave them thin.

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

## 1. Context — [FILL IN]

What is this codebase, what does this specific area do, and why does this
task exist right now (what triggered it — a bug report, a review finding, a
user request, a design doc)? Link the design doc / prior PR / prior agent
report this task builds on, if any. An agent with zero memory of this
conversation must be able to orient itself from this section alone.

## 2. Task — [FILL IN]

The concrete thing to build/fix/investigate. Be specific: file paths where
already known, exact symptom or exact contract, not a vague direction.
"Fix the chapters bug" is not a task; "P0-1: chapter persistence is gated
behind `isFullyReceived` in `web/app/api/analyses/persist/route.ts`, move it
to fire on every chunk like the transcript safety-net write above it does"
is a task.

## 3. Goal / definition of done — [FILL IN]

What does success look like, concretely enough that a DIFFERENT agent could
look at the finished diff and judge pass/fail without re-deriving intent?
Not "chapters work" — "a chunked analysis that's interrupted after chunk 2
of 5 still has a real `transcript_chapters` row for that video, verified via
a live DB query."

## 4. Expected results — [FILL IN]

What should exist when this is done: new files, new endpoints, new test
files, updated docs. List them so the completion report has something
concrete to check off against, and so CC's verification pass knows what to
look for without guessing.

## 5. Task-specific skills/tools/plugins/MCPs — [FILL IN]

CORE skills (qa-intel, contract-auditor, `/simplify`) and the three tenets
(contract, E2E, tangent hunt) are **[ALWAYS INCLUDE]**, below — don't
re-list them here. This section is ONLY for what this SPECIFIC task needs
beyond that baseline: which SELECT skills from `.claude/skills/pr-review-workflow`'s
live trigger list apply (re-read the list fresh, don't recall it from
memory or a prior prompt — the trigger conditions are keyed off exactly
what the diff touches); which MCP tools are needed (Supabase MCP for a
migration/live-DB task, code-review-graph for a review/audit task, Sentry
MCP for an incident investigation, etc.) and why; any project-specific
constraint that applies to this task and not others (e.g. "this touches a
SECURITY DEFINER function, the REVOKE EXECUTE sub-check applies").

## 6. Fixtures — [ALWAYS INCLUDE, then FILL IN task-specific additions]

**[ALWAYS INCLUDE]**: Before touching any code, run the project's
`code-review-graph` MCP tools (`build_or_update_graph_tool` first, then
`get_review_context_tool`/`get_impact_radius_tool` scoped to the files this
task touches) — this project's CLAUDE.md mandates this as Step 0, before
Grep/Glob/Read, for token efficiency and blast-radius awareness. Never skip
straight to file reads.

**[FILL IN]**: Any other required starting state — a specific commit/branch
to start from, a specific live-DB state to verify before assuming the
schema is a certain shape, a specific existing test file to read as the
established pattern to follow (name it explicitly — "follow the pattern in
X" is only useful if X is named).

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

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' on output, empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # THE EXACT CI FLAGS — the bare default run has different exit-code behavior and will give a false pass
pnpm tsx web/scripts/contract-auditor.ts
```

---

## Why this template exists (meta, not part of the dispatched prompt)

Created 2026-08-06 after a dispatched OC prompt for the chapters-decoupling
task omitted an explicit ledger-protocol instruction — OC only posted its
`[IN_PROGRESS]` entry after the user manually reminded it mid-task, meaning
the dispatching prompt itself was the gap, not the agent. Every
**[ALWAYS INCLUDE]** section above exists because omitting it caused a real,
observed problem earlier in this project's history:
- Ledger protocol: skipped once, caused a same-checkout collision between
  two agents (2026-08-03).
- Three tenets / E2E proof requirement: this exact chapters feature had
  TWO separate rounds of "verified in isolation, broken end-to-end" findings
  before this requirement was written down explicitly.
- code-review-graph as Step 0: this project's CLAUDE.md already mandates it,
  but it was being skipped in practice until made a template fixture.
- Report format: needed for CC's verification pass to have something
  consistent to check every single report against.

If a dispatched prompt is missing any **[ALWAYS INCLUDE]** section, that's a
process bug in the dispatch, not a forgivable shortcut — fix the prompt, not
just the agent's behavior after the fact.
