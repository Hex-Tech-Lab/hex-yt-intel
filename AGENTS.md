# hex-yt-intel: Agent Reference (v1.8.0)

**Monorepo**: pnpm workspace | **Node**: 24.16.0 | **TS**: 6.0.3 strict | **ESM**

---

## 1. BUILD / LINT / TEST COMMANDS

All commands run from repo root via `pnpm --filter`:

| Task | Command |
|---|---|
| Dev (web) | `pnpm --filter @hex-yt-intel/web dev` |
| Dev (worker) | `pnpm --filter youtube-intelligence-worker dev` |
| Build (web) | `pnpm --filter @hex-yt-intel/web build` |
| Build (worker) | `pnpm --filter youtube-intelligence-worker build` |
| Type-check (web) | `pnpm --filter @hex-yt-intel/web type-check` |
| Lint (web) | `pnpm --filter @hex-yt-intel/web lint` |
| Format (web) | `pnpm --filter @hex-yt-intel/web format` |
| All Playwright tests | `pnpm --filter @hex-yt-intel/web test` |
| **Single Playwright test** | `pnpm --filter @hex-yt-intel/web exec playwright test tests/production-verification.spec.ts` |
| **Single Playwright by name** | `pnpm --filter @hex-yt-intel/web exec playwright test -g "test name"` |
| Single vitest file | `pnpm --filter @hex-yt-intel/web exec vitest run lib/__tests__/rate-limit-sliding-window.test.ts` |
| Preflight | `pnpm --filter @hex-yt-intel/web preflight` |

> Pre-commit: run `type-check` + `lint` + `test` (Playwright requires `pnpm dev` running or `DEPLOYMENT_URL` set).

---

## 2. CODE STYLE GUIDELINES

### Imports (order — grouped with blank lines)
1. Framework / lib (`react`, `next/server`, Zustand, `@sentry/nextjs`)
2. Third-party (`zod`, `@supabase/ssr`, `d3`)
3. Internal `@/` aliases (`@/lib/ports`, `@/store/`, `@/hooks/`)
4. Types: `import type { ... }` separate from value imports
- Named exports only. No `export default` for components or functions.
- Barrel files: `@/lib/ports` re-exports all ports (`export * from './AuthPort'`).

### Naming
- **Components**: PascalCase, function declarations (`export function VideoCard(...)`)
- **Hooks**: camelCase with `use` prefix (`useSSEStream`, `useAnalysisStore`)
- **Zustand stores**: camelCase with `use` prefix + `Store` suffix
- **Ports/Adapters**: PascalCase + `Port`/`Adapter` suffix (`AuthPort`, `SupabaseAuthAdapter`)
- **UseCases**: PascalCase + `UseCase` suffix (`CreateAnalysisUseCase`)
- **Zod schemas**: PascalCase + `Schema` suffix (`AnalysisCreateSchema`)
- **Files**: PascalCase for components, kebab-case for utilities
- **Constants**: `UPPER_SNAKE_CASE`

### Types & Interfaces
- `interface` for public contracts; `type` for unions/utility types
- Strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noImplicitReturns`
- `@/*` path aliases — never use relative imports for cross-directory references
- Prefer Zod `safeParse` at API boundaries over ad-hoc validation

### Error Handling
- Universal catch pattern: `error instanceof Error ? error.message : String(error)`
- Use case returns discriminated union: `{ type: 'cache_hit' | 'processing' | 'error', ... }`
- API routes use early-return guard pattern: `if (!identity) return NextResponse.json(..., { status: 401 })`
- Sentry: `Sentry.captureException(error, { contexts: { ... } })` in every catch block
- Settlement guard: `hasSettled` boolean to prevent double-settlement in streaming code
- Log with structured tags: `console.error('[analyses]', { message, url })`

### File Structure
```
web/
  app/api/<name>/route.ts    — Next.js App Router API routes
  lib/
    ports/                    — Abstract interfaces (hexagonal ports)
    adapters/                 — Concrete implementations
    usecases/                 — Business orchestration
    services/                 — Domain services
    types/                    — Zod schemas + TS types
  store/                      — Zustand stores
  hooks/                      — React hooks
  components/                 — UI components (atomic design)
  tests/                      — Playwright E2E tests
worker/
  src/
    ports/
    services/
    worker.ts                 — Hono app entry
```

---

## 3. ARCHITECTURAL RULES (from CLAUDE.md)

- **Law #1**: Pre-query cache hit — always check `analyses` table by `video_id` + `user_id` before processing
- **Law #2**: Dual timeouts — 3s connection / 25s (Vercel) or 90s (Worker) streaming
- **Law #3**: All routes MUST stream responses to extend connection lifetime
- **Law #4**: Hybrid Edge — Vercel ~8s (auth/quota) → CF Worker ~58s (LLM) → S2S `/persist` (HMAC)
- **Frozen stack**: pnpm only, Tailwind + Astryx (`@astryxdesign/core`/`theme-neutral`) — NOT shadcn/ui, dropped and deleted 2026-08-02 — Node 24.16.0 LTS

---

## 4. PR REVIEW CONFIDENCE DEGREE

Minimum gate: **Cubic + CodeRabbit + Snyk + DeepSource + CI/CD + qa-intel**
Local gates (must pass): `tsc --noEmit`, `lint`, `qa-intel`

Confidence = weighted sum of passing tools, re-normalized when tools timeout.

| Tool | Weight | Wait Limit |
|---|---|---|
| Cubic | 30 | 3 min |
| CodeRabbit | 20 | 15 min (free tier may timeout) |
| Snyk | 15 | 3 min |
| DeepSource | 15 | 5 min |
| CI/CD Pipeline | 10 | 5 min |
| Vercel | 5 | 5 min |
| CodeQL | 5 | 5 min |

**Penalties**: CodeRabbit timeout -15, FAILURE with findings -20, unaddressed P0 -100.
**Decision**: ≥85 → merge, 60-84 → human review, <60 → fix & repeat.

---

## 5. SHARED COMMUNICATION PROTOCOL (STRICT — MUST FOLLOW)

### 5.0 Agent Roster & Model Assignments (added 2026-08-17)

If you are one of the agents below, this is your real assignment — read it before starting work.

- **CC (Claude Code)**: sink orchestrator / verifier. Independently re-verifies every other agent's claims against real sources (actual API/dist catalogs, live curl or DB queries, direct code reads) before accepting them — a report saying "verified" is not itself sufficient, including from CC's own dispatched background agents. Owns final merge sign-off.
- **AGY (Antigravity, Gemini Flash 3.6 — 3.7 confirmed available as of 2026-08-17, low effort)**: execution agent for larger multi-file waves, especially reasonable at UI work; ledger-disciplined, reports per-subtask.
- **OC (opencode / DeepSeek v4 Flash, low effort)**: preferred default for both investigation and execution on well-scoped findings — give it the raw finding plus exact context and let it investigate, don't pre-derive the root cause first.
- **Cline (new, added 2026-08-17)**: another local coding-agent tool, distinct from OC even though it can reach some of the same underlying OpenRouter models. Available model/effort presets: **DeepSeek v4 Flash, low effort** (same model family as OC's default — use for the same class of well-scoped, cost-sensitive tasks) and **NVIDIA Nemotron 3.5 Lightning, paid tier** (real model, confirmed on OpenRouter — `nvidia/nemotron-3.5-lightning`, MoE 30B total/3B active params, 1M context, released 2026-08-11; a free tier also exists but the paid tier is what's available here — real per-use cost, weigh against the bootstrap constraint). Any effort level is available for the Nemotron model, but low effort is the default preference unless a task specifically needs more. Real output quality of the Nemotron Lightning paid tier not yet characterized on this project's actual work — verify before routing anything load-bearing to it, same standard as every other agent.
- **GCW (Gemini Web)**: escalation path for tool failures, not a primary executor.

**Routing guidance, given the bootstrap cost constraint (standing, not situational)**: default to the free/cheapest options (OC's or Cline's DeepSeek v4 Flash, low effort) for well-scoped investigation/execution work. Reach for Cline's paid Nemotron Lightning tier only when a task's real complexity or quality bar genuinely warrants it over the free-tier options — not as a default upgrade. AGY remains the pick for UI-heavy multi-file waves specifically.

### 5.0.1 Standing user preferences & lessons learned (curated for cross-agent use, added 2026-08-17)

The user (Kelly) works with multiple agents in this repo (CC, AGY, OC, Cline) and expects the same standards from all of them, not just Claude Code. These are curated from real, repeated corrections in past sessions — Claude-Code-tool-specific items (skills, MCP servers) are deliberately excluded since they don't apply to other tools; these are the genuinely cross-agent-relevant ones.

- **Never appease — evidence-based pushback.** If you disagree with a request or think an approach is wrong, say so directly with real evidence (code you read, data you checked), not a hedge. Don't react dramatically either way.
- **Verify, don't trust self-reports.** A report saying "done" or "verified" — from any agent, including your own prior turn — is not sufficient on its own. Re-check against real sources (actual file contents, live queries, real command output) before relying on it or relaying it to the user or another agent.
- **10x self-critique before implementing.** Before any non-trivial change, write out real edge cases (races, partial states, single-source-of-truth violations, blast radius) — don't skip straight to the fix.
- **No hardcoded magic numbers.** Any timeout, limit, or tunable constant should go through the Settings Registry pattern already established in this codebase (see existing `remediation.*`, `billing.*` keys), not be inlined. Before bumping any existing constant, check→count→estimate real usage first.
- **Todo-list discipline.** For any multi-step task, track it explicitly (a TODO comment block, a tracked list in your own working notes) rather than holding steps in your head — this project's standing expectation, not optional.
- **Multi-engine research, staggered-progressive.** When research is needed, don't rely on a single source or a single search. Skim broadly first, then expand deeper specifically where a real signal appears (a contested claim, a surprising number, something directly relevant to this project's specific context) — don't stop at the first plausible answer, and don't exhaustively deep-dive everything by default either.
- **Negative-control verification for bug fixes.** When fixing a live bug, where practical: revert the fix, confirm the symptom actually reproduces, then reapply — proves the fix addresses the real cause, not a coincidence.
- **Status updates as tables, not prose, for anything covering 3+ items.** Item / status / why — scannable, not paragraphs.
- **Contract-first, not surface-level.** Before implementing against an API, DB schema, or external contract, verify the actual current shape (real query, real schema check, real API response) — don't trust a type definition or a memory of what it used to be.
- **Same-checkout discipline.** If you and another agent (AGY, OC, another Cline instance, Claude Code) might be working in the same git checkout concurrently, check `git status`/`git diff` before committing anything — don't assume the working tree reflects only your own current task. Prefer isolated worktrees when running multiple agents concurrently if that's an option for your tool.

### 5.0.2 Skill stack — CC's full ~63-skill set is symlinked and usable by every agent (corrected 2026-08-17)

Claude Code holds the source-of-truth skills; every other agent tool (Cline included) gets the same set via symlink — not a subset, not Claude-Code-only. If your tool can see a skill directory (Cline: confirmed in its settings — 63+ skills visible), treat that skill as directly usable, not informational-only.

**Standing rule, applies to every agent on any non-trivial task, not just Claude Code**: run at minimum **13 skills** per task — the CORE set plus SELECT skills triggered by what the diff actually touches. This is the same rule documented in the `pr-review-workflow` skill's Phase 1 (Internal Skill Layer). Do not skip straight to a narrow fix without running the applicable stack.

- **CORE (every task, no exception)**: `qa-intel`, `contract-auditor`, `/simplify` (4-parallel-agent pass: reuse/simplification/efficiency/altitude).
- **SELECT (trigger from the actual diff, not memory — re-check the live list each time)**: `supabase-postgres-best-practices` + `supabase` (migrations/queries/RLS), `owasp-top-10` (new fetch/auth/secret/webhook path), `react-best-practices` (React/hooks/bundle), `composition-patterns` (component prop API changes), `web-design-guidelines` (user-visible UI/UX/a11y), `vercel-optimize` (perf/cost regression), `database-architect-10x` (heavy schema changes), plus whatever else the live skill listing surfaces as relevant.
- **High-stakes only, not routine**: `llm-council` (13-advisor + Monte Carlo, or the 5-lens scaled-down mode), `stress-test`.
- Use `pr-review-workflow`'s Phase 1/2 structure as the reference process end-to-end (contract definition, E2E verification, tangent hunt, RCA-before-fix, structured report) — this applies to any agent dispatched on a well-scoped finding, not just OC/AGY.

### 5.0.3 Real incident record — MCP config task, 2026-08-17 (read before touching any MCP/tooling config)

A first-day MCP setup task by Cline produced four distinct, real errors in sequence — recorded here so they don't repeat, for Cline specifically and any agent touching secrets/tooling config:

1. **Never echo credential values into chat, ever — not even "for verification."** Cline printed 5 live API key/token values in plaintext across two separate messages this session. Confirm a key's *presence* (`grep -c` or similar, redacted) — never its value. This is a hard rule, not a judgment call.
2. **`uvx` runs PyPI/Python packages only; `npx`/`pnpm dlx` run npm packages.** Don't guess which registry a package lives on — verify before writing it into a config (`npm view <pkg>` or check the registry directly). A first attempt used `uvx` for npm packages (wrong registry entirely); a second attempt correctly identified them as npm but reached for `npx`, which is broken in WSL2 in this project (see §7 pnpm-only rule) — should have been `pnpm dlx` from the start.
3. **Don't invent package names from tool-call strings you've seen elsewhere.** The very first attempt used `mcp__plugin_exa_exa` and `mcp__brave-search__` as if they were installable packages — those are Claude Code's internal `mcp__<server>__<tool>` tool-namespacing convention, not real packages on any registry. If a package name isn't independently verified (real registry page, real docs), don't write it into a live config.
4. **Verify the file on disk before reporting a fix as done.** At least one status report described a config state (`npx`) that did not match what was actually written to `.mcp.json` at the time — either a stale re-report or a report written without re-reading the file post-edit. Before saying "fixed," re-read the actual file and quote what's really there.

General principle underlying all four: this is the same "verify, don't trust a self-report" standard already documented in §5.0.1 — it applies to your own claims about your own work, not just to trusting other agents.

**7. Never background async work you plan to "wait for" — it ends your turn and you don't come back (2026-08-18).** Hit 5 times in one session across different agents: spawning a sub-agent, a `run_in_background` Bash process, or a Monitor-watched task, then ending your response to "wait for the notification" does NOT work the way it sounds — your turn being marked complete means a human has to notice and manually resend you; you are not automatically resumed. For any task involving many sequential API calls (a fidelity test, a batch job, anything with dozens of real HTTP calls): make every call synchronous and foreground, one after another, in your own tool-call sequence, across as many of your own turns as needed — never background it and never delegate to another agent hoping it will "just finish" while you wait. If a task looks too large for one pass, do it in explicit continuation turns yourself, don't hand off to async machinery.

**6. No setting without empirical backing (2026-08-18) — arbitrary figures are the root cause of real production bugs, not a shortcut.** The `digest.maxOutputTokens=6000` fix from item 5 above was itself only a padded guess (comfortable multiple over 4 observed samples), not empirically derived — flagged directly by the user as not good enough. Standing rule going forward for ANY numeric setting (token caps, timeouts, batch sizes, thresholds): pull real existing production records, correlate the setting's driver variable against real historical outcomes (e.g., output tokens vs. input transcript/markdown size), derive the real relationship the data supports (ratio, regression, or empirical max), apply a reasoned margin (e.g. 15-20%), and leave the derivation — data source, sample size, date, formula — as an inline comment or linked doc so the number is traceable, not asserted. This extends and sharpens the existing "no hardcoded magic numbers" rule (§5.0.1) — the fix isn't just "move it to the Settings Registry," it's "back the value with real data before setting it there."

**5. `.env.local` presence ≠ loaded into your process environment (2026-08-18).** Two separate agent runs (OC and Cline/Nemotron) independently reported "no API key" / "no DB access" and stopped their tasks as blocked, when the real keys were confirmed present in `.env.local` the whole time (`grep -c` confirmed `OPENROUTER_API_KEY` and a Supabase service-role/access-token key both present). A `.env.local` file existing in the repo does NOT mean its variables are in your shell/script's environment — that only happens if something explicitly loads it (`set -a; source .env.local; set +a` in bash, or a dotenv loader in a script). Before reporting "key not found" as a blocker, explicitly load the file first and retry — don't conclude a credential is missing just because an unloaded shell doesn't see it. Separately: the Supabase MCP server here uses OAuth (no static key in its config), which can fail silently if your session isn't authenticated — if it does, don't treat that as "no DB access" either; fall back to querying Supabase's REST API directly using the service-role key from `.env.local` (never print the value, reference it via env var).

**MANDATORY: Strict Agent Protocol — follow at ALL times.**

**Before starting any task OR subtask**:
1. Read `.memory/AGENT_LEDGER.md` to check active status of ALL sibling agents
2. Read `.memory/ADRS.md` for any active/in-progress ADRs that affect your work
3. Post `[IN_PROGRESS]` with intent, target files, and timestamp
4. Check with sibling agents for conflicting work before touching any shared file

**During work**:
- After EVERY subtask: re-read ledger for new entries from other agents
- Before any cost, logic, or architecture decision: write an ADR entry and get user confirmation

**After completing a task**:
1. Update ledger entry to `[DONE]` with brief summary
2. Notify sibling agents who may be affected
3. Check ledger for any new entries that appeared during your task

**Cross-Agent Corrections (Two-Way Communication)**:
- If Agent A finds an issue in Agent B's work: add `[NOTE for AgentB]` to the ledger with: file, issue, fix needed
- Agent B MUST respond with `[ACK AgentA]` or `[DISPUTE AgentA]` once reviewed
- The original poster clears the note with `[RESOLVED AgentA]` only after Agent B confirms or the issue is fixed
- If unresolved after 2 rounds, escalate to `[SINK: escalation]` for the orchestrator
- Format:
  ```
  [2026-06-18T12:00+03:00] [OCT2] [NOTE for GCT1] worker/foo.ts:15 – function bar() has unused param. Fix: remove or prefix with _. Confirmed by owner? no
  [2026-06-18T12:30+03:00] [GCT1] [ACK OCT2] worker/foo.ts:15 – fixed in commit abc123.
  [2026-06-18T12:31+03:00] [OCT2] [RESOLVED OCT2] worker/foo.ts:15 – confirmed.
  ```

**ADR Requirement (MANDATORY)**:
- ANY decision involving cost, logic changes, or architecture must be written as an ADR in `.memory/ADRS.md`
- Format: `[YYYY-MM-DD] [OCT1|GCT1|...] [DECISION] Brief title. Rationale: ... Alternatives: ... Confirmed by user: yes/no`
- Do NOT implement until user confirms the ADR
- Exceptions: bug fixes, dependency bumps, test additions

**Orchestrator "Sink" pattern**: For multi-stage workflows, the lead agent logs `[SINK: Workflow Name]`. Sibling agents log sub-tasks but only the Sink merges/closes.

**Dispatching a task to another agent (or to yourself)**: build the prompt from `docs/agent-prompts/TEMPLATE.md`, don't write one from scratch or from memory. It has fill-in sections (Context, Task, Goal, Expected results, task-specific skills/tools/MCPs, task-specific fixtures) plus always-included sections that reference this protocol, the three verification tenets, required gates, and the report format CC checks every completion report against. Save the filled-in copy to `docs/agent-prompts/<date>-<agent>-<short-name>.md` before dispatching (2026-08-06 — created after a dispatched prompt omitted the ledger-protocol instruction above and the agent only followed it after manual user intervention).

---

## 6. ESLint & FORMATTING

- ESLint 8.x (`web/.eslintrc.json`) — extends `next/core-web-vitals` + `@typescript-eslint/recommended`
  - `@typescript-eslint/no-unused-vars`: warn
  - `@typescript-eslint/no-explicit-any`: off
- Prettier 3.8 (no config — defaults) — run via `pnpm --filter @hex-yt-intel/web format`
- No Biome, no Prettier config file — defaults apply

---

## 7. TESTING

- **Primary**: Playwright 1.60 — `web/tests/` (E2E, Chromium only, full parallel)
- **Secondary**: Vitest 4.x — `web/lib/__tests__/` (unit tests, no dedicated config yet)
- Playwright config auto-boots `pnpm dev` locally, skips when `DEPLOYMENT_URL` is set
- Test helper: `vitest run` works via tsconfig defaults

---

## 8. GCT2 AGENT PROTOCOL & SCHEDULE
- **Protocol**: Always follow the set agent protocol without being reminded. Inform others and get updates from others before and after every task and during with every subtask.
- **Parallel Workflow**: Orchestrate parallel agents. Estimate effort + file/LOC deltas. If >10m, run ≤5 concurrent agents; as one finishes, spawn another and rebalance remaining tasks for max throughput. Ensure no toe stepping and no work repeated.
