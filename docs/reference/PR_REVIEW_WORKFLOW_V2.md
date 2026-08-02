---
title: PR Review Workflow V2
description: Intelligent 6-phase pipeline with tool discovery, effort evaluation, and full-stack AST intelligence.
version: 2.0.0
status: authoritative
---

# PR REVIEW WORKFLOW V2: THE INTELLIGENT PIPELINE

This workflow governs all feature development. It is self-improving and context-aware.

---

## 🚀 PHASE 0: CONTEXT DISCOVERY & EVALUATION
**Goal: Determine if a PR is warranted and detect the current environment.**

1.  **Environment Detection**:
    *   Am I on a feature branch? (`git branch --show-current`)
    *   Is there an existing PR? (`gh pr view --json number`)
    *   *Decision*: If already in a PR, skip to Phase 2 (Harvest). If confused, **ask the user** for intent.
2.  **Effort Evaluation**:
    *   Calculate diff size (`git diff --shortstat main`).
    *   Check review tool quotas via `context7` (e.g., Cubic: 20/mo, CodeRabbit: refill model).
    *   *Decision*: If the change is trivial (e.g., < 10 lines, documentation only), consider a direct merge to `main` (if authorized) or a simplified review. If substantial, proceed to Phase 1.

---

## 🛠️ PHASE 1: LOCAL ISOLATION & AST PULSE
**Goal: Structural verification before submission.**

1.  **Branching**: (If new) `git checkout -b feature/chunk-[id]-[description]`.
2.  **AST Intelligence**: 
    *   Run `pnpm type-check` to ensure type safety.
    *   Enforce **Hex-Lite + DDD** boundaries: No infrastructure leaks in domain services.
3.  **Full-Stack Pattern Audit**:
    *   **DB**: Supabase RLS, partitioning, `auth.uid()` checks.
    *   **Logic**: 11-dimension parallel streaming stability.
    *   **UI**: Tailwind/Astryx alignment (NOT shadcn — dropped 2026-08-02), zero-CLS markdown rendering.
4.  **Triple-Gate**: `rm -rf node_modules pnpm-lock.yaml && pnpm install && pnpm build`.

---

## 📡 PHASE 2: TOOL ORCHESTRATION (DISCOVERY)
**Goal: Trigger the high-fidelity review stack.**

1.  **Open/Update PR**: `gh pr create` or `git push`.
2.  **Autonomous Tool Discovery**: Trigger all available tools:
    *   **Cubic MCP**: Architectural and pattern verification.
    *   **CodeRabbit**: Logic and edge-case AI review.
    *   **Snyk**: Security and dependency audit.
    *   **SonarCloud**: Quality gate and technical debt check.
3.  **Matrix Creation**: `docs/testing/chunk-[id]-review-matrix.md`.

---

## 🔧 PHASE 3: SEQUENTIAL RESOLUTION
**Goal: Address feedback while maintaining architectural invariance.**

1.  **Resolve findings**: Use the matrix to track progress.
2.  **Continuous Verification**: Re-run local gates after every fix.
3.  **Pattern Enforcement**: If a fix violates a project pattern, revert and find an idiomatic solution.

---

## 📈 PHASE 4: QUOTA MANAGEMENT & SELF-IMPROVEMENT
**Goal: Efficiency and evolution.**

1.  **Quota Guard**: If limits are reached, wait for refill or escalate to the human orchestrator.
2.  **Self-Improvement**: **Discovery from PR**: If this review revealed a new pattern or error class, update this workflow or `GEMINI.md` immediately.

---

## 🏁 PHASE 5: THE 10X SIGN-OFF & MERGE
**Goal: Final authority check.**

1.  **Checklist**:
    *   ✅ All tool checks green (Cubic, Snyk, Sonar, CodeRabbit).
    *   ✅ AST pulse confirms 0 "any" types.
    *   ✅ Resolution Matrix 100% complete.
2.  **Merge**: `--no-ff` merge into `main`. **Merging restricted to PR Authority (CC).**

---

## 📝 PHASE 6: POST-MERGE STEWARDSHIP
**Goal: Clean state for next agent.**

1.  **Cleanup**: Delete branch locally and remotely.
2.  **Documentation**: Update `AGENTS.md` with commit hashes, gate results, and tool metrics.

---

## ⚠️ MANDATORY TRIGGER
Invoke `/pr_review_workflow` (which points to this V2 spec) at the start of every session.
