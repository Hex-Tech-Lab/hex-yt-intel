# hex-yt-intel: Master Infrastructure & Architectural Spec (v1.4.2)

---

## 1. CORE ARCHITECTURAL LAWS

### Law #1: Pre-Query Cache Hit Circuit
Before EVERY analysis request, the system must query the Supabase `analyses` table matching the `video_id` and `user_id`. If found, it returns the cached markdown instantly.

### Law #2: Stratified Dual-Timeouts
The OpenRouter model fallback sequence utilizes a stratified dual-timeout architecture:
- **Connection Handshake**: 3-second hard timeout.
- **Token Streaming Window**: 25-second (Vercel) / 90-second (Worker) maximum read.

### Law #3: Streaming Response Execution
All analytical route handlers MUST implement dynamic response streaming to extend the connection lifetime.

### Law #4: Hybrid Edge Symphony (ADR 005)
The platform utilizes a multi-cloud hybrid flow:
- **Vercel**: Auth/Quota Bouncer (~8s).
- **Cloudflare**: High-latency LLM Streaming (~58s).
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
- **OC (opencode / DeepSeek v4 Flash, low effort)**: **preferred default for both investigation and execution** on well-scoped findings (bug reports, PR review comments, tech-debt roster items) — do NOT pre-derive the root cause before handing off; give OC the raw finding plus exact context (file:line where already known, links, error text) and let it investigate. Prompts to OC still follow the same handholding/detailed format as AGY prompts (full context, skill stack, gates, structured report) — delegating investigation is not license to write a terse prompt.
- **GCW (Gemini Web)**: escalation path for tool failures, not a primary executor.

**Same-checkout warning**: AGY and OC have both been run in the same shared working-tree checkout (not isolated git worktrees) at least once this session, resulting in mixed uncommitted diffs from two agents on one branch that sat unpushed/undeployed for hours before being noticed. Prefer isolated worktrees per agent when running AGY/OC concurrently with other work; if a shared checkout is unavoidable, check `git status`/`git diff` per-file before committing anything, don't assume the working tree reflects only your own current task.

---

## 3. THE ADR LEDGER (Architectural Decision Records)

| ADR | Date | Title | Status |
|---|---|---|---|
| 001 | 2026-05-12 | Supabase-only Auth Migration | ✅ |
| 002 | 2026-05-14 | Atomic Quota Enforcement (Upstash Redis Lua) | ✅ |
| 003 | 2026-05-16 | LLM Model Cascade (nemotron-3-nano lead + free fallbacks → Haiku 4.5) | ✅ |
| 004 | 2026-05-21 | Request-Scoped Supabase Client | ✅ |
| 005 | 2026-06-01 | Hybrid Edge Architecture (Vercel/CF) | ✅ |
| 006 | 2026-06-06 | Structured JSON Streaming (see `docs/specs/ADR_006_STRUCTURED_JSON_STREAMING_2026-06-06.md`) | ✅ |
| 007 | 2026-07-05 | Stuck-Analysis Reaper (QStash-driven finalize sweep for orphaned `processing` rows; PR #110) | ✅ |
| 008 | 2026-07-07 | Chat Grounding Security Gate — no usable analysis ⇒ refuse, never answer from general knowledge (PR #125) | ✅ |
| 009 | 2026-07-07 | Chat Conversation↔Analysis Ownership Binding — owner-verified at creation + userId-scoped grounding read (PR #126) | ✅ |
| 010 | 2026-07-07 | Dimension-0 Executive Digest — single idempotent cheap-cascade completion, uncounted (PR #127) | ✅ |
| 011 | 2026-07-10 | LLM Model Routing Policy & Fallback Cascade Strategy (Wave 7 clarification; Haiku 4.5 primary, separate CHAT_CASCADE for digest) | ✅ |
| 012 | 2026-07-19 | Ephemeral Transcript Storage & 72h Compliance Retention Pipeline — new transcripts/transcript_markers tier + retention enforcement | ✅ |
| 013 | 2026-07-19 | CI-Automated Production Schema Migration via `supabase db push` — ci-cd.yml runs on migrations/ with no manual gate | ✅ |
| 014 | 2026-07-19 | Video-ID-Scoped Chat Grounding Fallback — chat_conversations.video_id column alongside ADR 009 analysis-scoped ownership binding | ✅ |
| 015 | 2026-07-19 | PR Confidence Calculator Fail-Closed Semantics — tool-query failures score 0 (not 100 false-confidence) as of 2026-07-19 re-audit fix | ✅ |
| 016 | 2026-07-19 | External Research-Harness API Key Boundary & Rotation Policy — SerpAPI/Exa/Decodo keys in scripts/research/; rotation tracked as ops task | ✅ |
| 017 | 2026-07-29 | `/dashboard` Client Bundle — Zod-Driven 535KB Chunk (see `docs/specs/ADR_017_DASHBOARD_BUNDLE_ZOD_REGRESSION_2026-07-29.md`) — Zod v4 (276.5KB, 52% of chunk) pulled in client-side via `useInputStore.ts`; remediation not yet implemented | 🔍 |
| 018 | 2026-07-30 | Migration Filename Must Match Supabase's Recorded Version — `apply_migration` (Supabase MCP) auto-timestamps its own version server-side, independent of the local `.sql` filename. A mismatch silently breaks ADR 013's CI `supabase db push` dry-run ("Remote migration versions not found in local migrations directory") with no alert — sat broken for multiple days before being caught (fixed commit `4ca8bad7`). **Rule: after every `apply_migration` call, immediately run `list_migrations` and name/rename the local file to the exact version it recorded — never invent your own timestamp for an already-applied migration. Before committing any migration work, run `pnpm exec supabase db push --dry-run` and confirm it reports the remote as up to date (or shows only the intended new migrations).** | ✅ |
| 019 | 2026-07-31 | Remediation Budget: Dollar-Denominated Token Bucket, Not Concurrency Count — OpenRouter exposes no hard concurrency limit (`rate_limit.requests` is `-1`/deprecated); the real constraint is the account's monthly $ spend cap, shared with live paying traffic. `remediate-missing-dimensions` (ADR-linked spec `docs/specs/ADR_019_REMEDIATION_BUDGET_TOKEN_BUCKET_2026-07-31.md`) gates spend via a Redis-backed token bucket (capacity = `min(budgetPercentOfRemaining% × OpenRouter live remaining balance, hardCapUsdCents)`, refilling continuously over `periodDays`) instead of a fixed batch size or mutex lock — concurrency and throughput both fall out of budget availability, not an arbitrary picked number. Candidate selection alternates oldest-first/newest-first each cycle ("pendulum") so neither a long-stuck row nor a fresh failure is ever starved. All three parameters are Settings Registry keys (`remediation.*`), editable without redeploy — never hardcode a tunable here again. | ✅ |
| 021 | 2026-08-02 | Granular Partial-Resume & Reaper Role Extension (scoping doc `docs/specs/ADR_021_GRANULAR_PARTIAL_RESUME_AND_REAPER_2026-08-02.md`) — one rule (piece present → leave alone, missing → refetch only that piece) applied uniformly across dimensions/metadata/transcript/digest/comments instead of today's all-or-nothing 5-bundle abort; extends the reaper's existing finalize/discard decision to a third outcome (requeue-partial) at sub-row granularity. Not yet implemented — pending sign-off on bundle-level-vs-dimension-level v1 scope. | 🔍 |

Full rationale for 008–010 in `docs/history/HANDOVER_2026-07-07-CHAT-SECURITY-AND-DIM0.md` §2 and `.memory/ADRS.md`.

---

## 4. INFRASTRUCTURE COORDINATES

- **Vercel App**: `https://hex-yt-intel.vercel.app` (prod domains, parallel cutover as of 2026-07-25: `https://yt-intel.getmytestdrive.com` and `https://v-intel.getmytestdrive.com` — both valid until a hard cutoff to v-intel; CORS/appUrl allowlists updated in `worker/src/middleware/cors.ts`. Still needs, outside my access: Supabase Auth URL Configuration + Google OAuth client redirect URIs updated with the new domain.)
- **CF Worker**: `https://yt-intel.hex-tech-lab.workers.dev`
- **DB Ref**: `adnmbikaqnxivalqoild` (Supabase — matches `NEXT_PUBLIC_SUPABASE_URL`)
- **Redis**: Upstash (Rate limiting / KV Cache)

---

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
