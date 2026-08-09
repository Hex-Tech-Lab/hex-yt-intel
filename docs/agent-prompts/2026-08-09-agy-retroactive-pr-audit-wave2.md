# Dispatch: AGY — Retroactive Skill-Audit Wave 2 (High/Medium tier PRs)

**Date**: 2026-08-09
**Agent**: AGY (Antigravity/Gemini)
**Dispatched by**: CC (Claude Code)
**Repo**: hex-yt-intel, branch: work off `main` directly (no branch protection, confirmed via `gh api repos/.../branches/main/protection` → 404), one small commit per real finding.

## Context

hex-yt-intel just completed retroactive full-skill audits on 16 PRs (#183-224, Critical + a subset of High/Medium tier), finding and fixing 5 real bugs out of 16 audited (~31% real-defect rate). This wave covers the **remaining, not-yet-audited** High/Medium tier PRs from the original triage: **#187, #193, #206, #210, #211, #200, #201, #208, #209, #194, #195, #196, #197, #198**.

This work is independent of the concurrent ADR 026 (grounded entity extraction) Phase 1 implementation CC is doing in parallel — different files, different subsystems, no overlap expected. **If you discover a file conflict with ADR 026 Phase 1 work (touching `web/lib/types/knowledge-graph.ts`, `web/lib/config/cascade.ts`, or anything under `worker/src/services/` related to KG/entity extraction), STOP and log it to the ledger instead of proceeding — do not silently resolve a conflict with concurrent in-flight work.**

## Task

For each PR in the list above, retroactively apply the full named-skill review stack (NOT just baseline gates — tsc/vitest/qa-intel/contract-auditor are the floor, not the ceiling) against the PR's CURRENT state on `main` (all are already merged — this is post-merge audit-and-fix-forward, not pre-merge review).

## Mandatory ledger protocol (non-negotiable — read `.memory/AGENT_LEDGER.md` before touching any file)

1. **Read** `.memory/AGENT_LEDGER.md` before starting any task or file mutation — check for other agents' active files, including CC's concurrent ADR 026 Phase 1 work.
2. **Write** an `[IN_PROGRESS]` line to the ledger before starting each PR's audit, naming the PR number and target files.
3. **Update** your line to `[DONE]` when that PR's audit+fix is complete, or `[SKIPPED: reason]` if genuinely clean.
4. **Re-read the ledger on every tick/PR transition** — not just once at the start. Check what other agents (including CC) are doing before starting the next PR in your list, in case scope has shifted.
5. You are a sibling agent, not the sink orchestrator for this workflow — you cannot finalize/merge the overall retroactive-audit initiative. CC re-verifies every finding you report before it's trusted (standing project rule — no agent's self-report is sufficient on its own).

## Mandatory per-PR steps (do not skip any)

1. **Contract definition + review**: for the PR's changed function(s)/component(s), state the expected contract (signature, prop shape, DB return type) before judging correctness.
2. **E2E verification**: unit-green is not sufficient — do a real check (manual repro reasoning, actual data shape check) proportional to what the PR touches, not just "does it compile."
3. **Tangent hunt**: check for related/adjacent issues in the same file/area while auditing the PR's specific diff, not just the original PR's exact lines. Report tangents even if not fixed this pass.
4. **RCA before fix**: for any real finding, root-cause it explicitly before patching.
5. **Run ALL applicable skills from the live list** (do not recall from memory) — CORE: `qa-intel` (`pnpm tsx scripts/verify-quality-engine.ts`), `contract-auditor` (`pnpm tsx web/scripts/contract-auditor.ts`), `/simplify` (bundled 4-parallel-agent pass: reuse/simplification/efficiency/altitude). SELECT: choose based on `git diff --name-only` for that PR's real changed files against the trigger list in `pr-review-workflow`'s Phase 1 (react-best-practices for React/hooks/bundle, owasp-top-10 for auth/secrets/external-fetch diffs, supabase-postgres-best-practices for migrations/queries, web-design-guidelines for UI/a11y-relevant markup, composition-patterns for new component prop APIs).
6. **Structured report format per PR**: RCA → Contract → Fix → Tangents found → Skills run + findings → Gates (tsc/qa-intel --ci --compare/contract-auditor, all must be clean before commit) → Files changed → commit hash.

## Report format (final summary after all 14 PRs)

One table: PR # | clean or N findings | fixed/deferred | commit hash(es) | tangents flagged. Plus a short prose note on anything that needed CC's judgment call (ambiguous fix, out-of-scope finding, real conflict with ADR 026 work).

## Explicitly out of scope

Do not touch `web/lib/types/knowledge-graph.ts`, `web/lib/config/cascade.ts`, or ADR 026-related files — those are CC's concurrent Phase 1 work. Do not open new PRs — commit small, gated fixes directly to `main` per this repo's established pattern for this exact kind of retroactive audit (see the completed Wave 1, 2026-08-08).
