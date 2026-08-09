# Dispatch: Wave 3 — Risk-Triaged Retroactive Skill Audit (#133–182 block)

**Date**: 2026-08-09
**Dispatched by**: CC (Claude Code)
**Repo**: hex-yt-intel, work directly on `main` (no branch protection, confirmed), one small gated commit per real finding.

## Context

Waves 1+2 fully audited PRs #183–224 (30 PRs, full named-skill stack, 7 real bugs found and fixed). #1–182 remains unaudited. Given a declining bug-hit-rate trend across the two completed waves (Critical tier: 0 new / Wave 1: 5 of 16 / Wave 2: 2 of 14) and real launch-timeline pressure, the agreed approach — explicitly approved by the user, not a default — is a **risk-triaged pass, not a full sweep**: only audit PRs from the #133–182 block that touch security/auth, billing/cost, or data-integrity/persistence risk, not all 50. #1–132 is explicitly deprioritized as lower relative risk (older, more production-battle-tested).

**Target PRs, pre-triaged by title/risk category** (do not add or drop PRs from this list without logging why in the ledger):

- **Security/Auth**: #150 (Stream Token Security — P1 ship blocker, 30 security tests), #169 (playwright.config disabling dev auth bypass)
- **Billing/Cost**: #170 (real server-side analysis cancellation, ADR 020 Phase 1), #173 (billing.chargeOnCancel + cancelled billing_status, ADR 020 Phase 2), #175 (OpenRouter cost ledger + admin cost UI, ADR 020 Phase 3), #176 (remediation budget calendar-month reset)
- **Data-integrity/persistence**: #133 (unify persona enums, CRITICAL blocks features), #135 (P0 cache contract violations + search validation), #139 (regression: empty dimensions on partial analysis + contract validation), #140 (critical post-merge: chat regression, persist validation, timeout), #141 (KnowledgeGraph aggregation + chat persist idempotency), #151 (production data persistence P0 critical bugs), #152 (P1 data integrity & validation fixes), #157 (PR confidence calculator fail-open vulnerability), #179 (atomic merge for validation_report concurrent-write race)

## Mandatory ledger protocol (non-negotiable)

1. Read `.memory/AGENT_LEDGER.md` before touching any file — check active files from any other agent, including CC's own concurrent ADR 026 work.
2. `[IN_PROGRESS]` line per PR before starting, `[DONE]`/`[SKIPPED: reason]` after.
3. Re-read the ledger between PRs, not just once at the start.
4. Sibling agent, not sink orchestrator — CC independently re-verifies every finding against the actual diff before it's trusted, same as every prior wave this session.

## Mandatory per-PR steps

1. Contract definition + review before judging correctness.
2. Real E2E verification proportional to what the PR touches — these are disproportionately security/billing/data-integrity PRs, so verify against real current DB schema/RLS/grants where relevant (query live via Supabase MCP, don't just read the migration file's narrative — this exact gap was the lesson from the #202 audit in Wave 1).
3. Tangent hunt — report adjacent issues even if not fixed.
4. RCA before fix, always.
5. Run ALL applicable skills from the live list (CORE: qa-intel, contract-auditor, /simplify; SELECT chosen from `git diff --name-only` against the trigger list in `pr-review-workflow`'s Phase 1 — given this batch's risk profile, expect `owasp-top-10` and `supabase-postgres-best-practices` to apply far more often than in Waves 1/2).
6. Structured report per PR: RCA → Contract → Fix → Tangents → Skills run + findings → Gates (tsc/qa-intel --ci --compare/contract-auditor all clean before commit) → Files changed → commit hash.

## Report format (final summary)

Same table format as Wave 2's final report: PR # | clean or N findings | fixed/deferred | commit hash(es) | tangents flagged.

## Explicitly out of scope

Do not touch `web/lib/types/knowledge-graph.ts`, `web/lib/config/cascade.ts`, `supabase/migrations/20260809110135_cascade_entity_extraction.sql`, or anything under ADR 026's remaining Phase 1 scope (retention_policies table, chunk-grouping function) — CC is handling that separately, through a proper branch+PR cycle this time, not direct-to-main. Do not touch PRs outside the 15 listed above without logging why.
