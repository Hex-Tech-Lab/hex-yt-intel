# hex-yt-intel: Master Infrastructure & Architectural Spec (v1.4.2)

---

## 1. CORE ARCHITECTURAL LAWS

### Law #1: Pre-Query Cache Hit Circuit
Before EVERY analysis request, the system must query the Supabase `analyses` table matching the `video_id` and `user_id`. If found, it returns the cached markdown instantly.

### Law #2: Stratified Dual-Timeouts (corrected 2026-08-07)
The OpenRouter model fallback sequence utilizes a stratified dual-timeout architecture, both registry-driven (`analysis.llmCascade.*` / `analysis.remediation.connectionTimeoutMs` -- see `scripts/quality-engine`'s no-hardcoded-tunables directive):
- **Connection Handshake**: worker-internal per-model handshake `analysis.llmCascade.handshakeTimeoutMs` (default 15s); the outer client-side (Vercel) connection wait before the worker starts responding is `analysis.remediation.connectionTimeoutMs` (default 3s, remediation path only -- the live SSE path has no outer wrapper timeout since the browser fetch itself has no deadline while the worker keeps streaming).
- **Token Streaming Window**: `analysis.llmCascade.timeoutMs` (default 4 min) per model-tier LLM call. This line previously said "90-second (Worker) maximum read" -- **that was never a real Cloudflare platform limit.** ADR 005 (internal ADR doc (private)) states plainly: "no execution timeouts (CF Workers have no duration limit while the client stays connected)" -- confirmed against Cloudflare's own current docs (CPU time is budgeted, default 30s/invocation on paid plans, up to 5 min configurable; time spent waiting on an outgoing `fetch()` does NOT count toward CPU time) and OpenRouter's own docs (no documented hard server-side timeout on streaming completions -- they send SSE keep-alive comments specifically to support long generations). The stale 90s figure caused a real incident (2026-08-06/07): a ~64-minute video's longer transcript/generation time hit the then-hardcoded 120000ms code timeout, force-aborted mid-generation with zero dimensions ever persisted (bundle-level, not dimension-level persistence -- separate open item, ADR 021) and zero Sentry visibility (timeouts were deliberately excluded from capture -- also fixed 2026-08-07, every abort/timeout is now captured).

### Law #3: Streaming Response Execution
All analytical route handlers MUST implement dynamic response streaming to extend the connection lifetime.

### Law #4: Hybrid Edge Symphony (ADR 005, corrected 2026-08-07)
The platform utilizes a multi-cloud hybrid flow:
- **Vercel**: Auth/Quota Bouncer (~8s).
- **Cloudflare**: LLM Streaming, effectively unbounded wall-clock duration while the client stays connected (see Law #2's correction -- the previous "~58s" figure here was never a real platform constraint either).
- **S2S /persist**: Tamper-proof server-to-server data persistence using HMAC signatures.

---

## 2. SHARED COMMUNICATION PROTOCOL (.memory/AGENT_LEDGER.md)

To enable high concurrency without toe-stepping, all agents MUST use the shared ledger:
1. **Read**: View `.memory/AGENT_LEDGER.md` before starting any task or file mutation to avoid active files.
2. **Write**: Append an `[IN_PROGRESS]` line specifying your intent, target files, and timestamp.
3. **Update**: Change your line to `[DONE]` when the task is complete.
4. **Orchestrator "Sink" Pattern**: For complex workflows (e.g., PR Reviews), the lead agent logs `[SINK: Workflow Name]`. Sibling agents log sub-tasks but **cannot** finalize or merge the overall workflow. Only the Sink Orchestrator is responsible for testing, verifying, merging, and closing out the overarching task.

### Agent roster (added 2026-08-03)

- **CC (Claude Code)**: sink orchestrator / verifier for most sessions. Independently re-verifies every other agent's claims against real sources (actual API/dist catalogs, live curl or DB queries, direct code reads) before accepting them — a report saying "verified" from any agent is not itself sufficient. Owns final merge sign-off.
- **AGY (Antigravity/Gemini)**: execution agent for larger multi-file waves; ledger-disciplined, reports per-subtask.
- **OC (opencode / GLM-5.3-flash via user preset `@preset/glm-53-flash-on-cheap` (Modal-first) — standard updated 2026-09-29, see "OC model standard" below)**: **preferred default for both investigation and execution** on well-scoped findings (bug reports, PR review comments, tech-debt roster items) — do NOT pre-derive the root cause before handing off; give OC the raw finding plus exact context (file:line where already known, links, error text) and let it investigate. Prompts to OC still follow the same handholding/detailed format as AGY prompts (full context, skill stack, gates, structured report) — delegating investigation is not license to write a terse prompt.
- **GCW (Gemini Web)**: escalation path for tool failures, not a primary executor.

**OC model standard**: private — see `docs/private/CLAUDE.private.md` (imported below). It covers the model, preset, provider routing, config files, launch rules, two-strike cutoff and traffic attribution. Any agent that changes the OC model, provider, or config must tell the user explicitly in the same turn.

**Same-checkout warning**: AGY and OC have both been run in the same shared working-tree checkout (not isolated git worktrees) at least once this session, resulting in mixed uncommitted diffs from two agents on one branch that sat unpushed/undeployed for hours before being noticed. Prefer isolated worktrees per agent when running AGY/OC concurrently with other work; if a shared checkout is unavoidable, check `git status`/`git diff` per-file before committing anything, don't assume the working tree reflects only your own current task.

### Model/task-fit routing

Private — see `docs/private/CLAUDE.private.md`. Skim `.memory/AGENT_LEDGER.md` for recent outcomes before routing an expensive task.

### Mandatory template for every agent dispatch prompt (added 2026-08-03, enforced as a file template 2026-08-06)

Every prompt dispatched to AGY, OC, a remote/worktree Agent-tool call, or written by CC for itself — investigation, execution, or both — MUST be built from **`docs/agent-prompts/TEMPLATE.md`**, not re-derived from memory or written ad hoc. Copy that file, fill in its `[FILL IN]` sections (Context, Task, Goal, Expected results, Task-specific skills/tools/MCPs, task-specific fixtures), and dispatch — do not paraphrase or drop its `[ALWAYS INCLUDE]` sections (ledger protocol, code-review-graph as Step 0, the three tenets, gates, report format). Save the filled-in prompt to `docs/agent-prompts/<date>-<agent>-<short-name>.md` before dispatching, same as every prior prompt in that directory.

This became a hard file-based template (not just a prose reminder) after a dispatched OC prompt omitted the ledger-protocol instruction and the agent only posted its `[IN_PROGRESS]` entry after the user manually intervened mid-task (2026-08-06) — the gap was in the dispatching prompt, not the agent's behavior. See the template file's own "why this exists" section for the other incidents behind each mandatory section.

---

## 3. THE ADR LEDGER (Architectural Decision Records)

Private. Every final ADR lives in the private companion repo (`docs/private/`, a checkout of `Hex-Tech-Lab/hex-yt-intel-private`; worktrees reach it through a `docs/private` symlink to the main checkout). The full ledger table is in `docs/private/CLAUDE.private.md`; the master index is `docs/private/ADR_INDEX.md`.

## 4. INFRASTRUCTURE COORDINATES

Private — see `docs/private/CLAUDE.private.md`.

@docs/private/CLAUDE.private.md

## 5. THE FROZEN STACK PROTOCOL (GCT Aligned — 2026-05-23)

**Package Management**: `pnpm` only  
**CSS Framework**: Tailwind CSS + Astryx (`@astryxdesign/core`, `@astryxdesign/theme-neutral`) exclusively — **NOT shadcn/ui**. shadcn was dropped entirely; `web/components/ui/` (the shadcn primitives) was confirmed dead (zero real imports) and deleted 2026-08-02. Before claiming a UI library is in use anywhere in this repo, verify actual imports (`grep -rl "from '@astryxdesign\|from '@/components/ui"`), not file/dependency presence — this exact stale claim caused a wrong instruction to an FE agent this session.

### Runtime & Build Infrastructure
(Exact pinned versions live in package.json / web/package.json — source of truth, don't duplicate here.)
- **Next.js**: patch-bumped 2026-07-24 for Dependabot #73-90 (SSRF in Server Actions/rewrites, DoS, cache confusion) — same minor line, no breaking changes.

---

## 6. PR CONFIDENCE CALCULATOR (WAVE 6 — 2026-07-09)

### Purpose
Multidimensional PR readiness scoring system that evaluates code quality across six independent tools. Designed as an **informational decision gate** (never blocking merge) to help team members assess PR maturity before review.

### Scoring Formula

| Tool | Category | Max Points | Criteria |
|---|---|---|---|
| **Cubic** | Code Architecture | 30 | Review score extracted from Cubic comments (normalized to 30) |
| **CodeRabbit** | Code Review | 20 | Passed checks from CodeRabbit review tool |
| **Snyk** | Security | 15 | Resolved security findings count |
| **CI/CD** | Automation | 10 | All GitHub Actions checks passed |
| **Vercel** | Deployment | 5 | Deployment status = READY or PRODUCTION |
| **CodeQL** | Static Analysis | 5 | Zero critical/high-severity alerts |

**Confidence = (Total Points ÷ 85) × 100%**

### Recommendations

| Confidence | Status | Action |
|---|---|---|
| **≥85%** | MERGE READY | Safe to merge; all quality gates met |
| **70–84%** | ACCEPTABLE (minor debt) | Mergeable; minor findings remain |
| **50–69%** | AT RISK (review findings) | Review findings present; address before merge |
| **<50%** | NOT READY (critical issues) | Critical issues identified; do not merge |

### Usage

```bash
pnpm dlx tsx scripts/calculate-pr-confidence.ts --pr=129
```

Runs automatically in CI/CD too (`.github/workflows/ci-cd.yml` → `final-status` job); score is appended to the PR status comment, informational only, never blocks merge.

**Error handling** (behavior contract, not obvious from a glance at the code): missing tools default to 0 points rather than crashing the calculator; GitHub API failures are logged but don't block output; malformed scores cap at the tool's max rather than erroring.

Implementation, exact output format, and per-tool detection logic: `scripts/calculate-pr-confidence.ts`.

### Philosophy

**Why Informational, Not Blocking?**
- No single metric can capture true merge readiness
- Context matters: risky refactors may score lower but be necessary
- Team judgment always overrides automation
- Prevents "gaming" the score by chasing points

**Complementary Tools**:
- Code reviews (human judgment)
- Architectural ADRs (design decisions)
- Integration tests (real-world behavior)
- Manual security audits (domain expertise)

See `docs/LESSONS_LEARNED.md` line 102 for the original formula rationale.

---

## 7. CODING STANDARDS & GOVERNANCE (Hex-Lite & DDD-Lite Enforced)

All agents MUST adhere to the 4 core Karpathy engineering tenets, strictly bound by the repository's Hex-Lite and DDD-Lite architectural boundaries:

1. **Think Before Coding**:
   - Surface assumptions explicitly; clarify ambiguities instead of guessing.
   - Check `.memory/AGENT_LEDGER.md` and `.memory/ADRS.md` to prevent collisions and align with architectural decisions.
   - Map blast radius before writing code.
2. **Simplicity First (Hex-Lite & DDD-Lite)**:
   - Build minimum viable logic; zero speculative abstraction layers or unused indirections.
   - Never confuse simplicity with architecture abandonment: strictly preserve existing Ports, Adapters, Domain boundaries, and Separation of Concerns (SoC).
   - Domain models hold business logic; adapters hold infrastructure code; route handlers remain ultra-thin dispatchers.
3. **Surgical Diffs**:
   - Modify ONLY target lines/files. Zero drive-by formatting, zero unsolicited refactors, strict blast-radius isolation.
4. **Goal-Driven Verification**:
   - Define empirical pass criteria; execute negative-control checks, vitest unit suites, strict type checks (`tsc --noEmit`), and `qa-intel:baseline` before closing tasks.

### Defensive Ledger Contract (Mandatory)

Any modification to a primary system configuration, fallback behavior, timeout constant, or API contract MUST trigger an automatic cross-reference against `.memory/DEFENSIVE_LEDGER.md`. If a touched module has mapped defensive relatives or shadow defaults, those fallback states must be audited, kept coherent, and updated synchronously in the same PR.

---

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
