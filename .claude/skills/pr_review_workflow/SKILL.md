---
name: pr_review_workflow
description: Display the authoritative multi-agent review workflow specification with all 6 phases, commands, and escalation protocols
triggers:
  - user types `/pr_review_workflow`
  - user asks "show me the workflow"
  - user asks "display the review process"
---

# Multi-Agent Review Workflow Skill

## Overview

This skill displays the canonical **MULTI-AGENT REVIEW WORKFLOW** — the authoritative specification for feature development, CI/CD feedback harvesting, and merge operations across all agents (CC, GC, KC).

**Single Source of Truth**: Stored in project memory and symlinked to `/docs/reference/MULTI_AGENT_REVIEW_WORKFLOW.md`

---

## What This Skill Does

When you invoke `/pr_review_workflow`, this skill:

1. **Loads the canonical workflow** from the authoritative source
2. **Displays formatted specification** with all 6 phases
3. **Provides command cheat sheet** for quick copy-paste
4. **Shows escalation matrix** for when to delegate decisions
5. **Enforces single source of truth** across all agent sessions

---

## The 6-Phase Workflow

### **PHASE 1: LOCAL ISOLATION & GATES**
- Create feature branch: `feature/chunk-[id]-[description]`
- Local triple-gate verification:
  - `pnpm type-check` (✅ 0 errors)
  - `pnpm lint` (✅ 0 violations)
  - `pnpm build` (✅ completes)
- Atomic commit message format
- Push to feature branch

### **PHASE 2: GITHUB PR & CI/CD HARVEST**
- Open PR on GitHub (base: `main`, head: feature branch)
- Wait for 4 tools to report (15-30 min):
  - CodeRabbit (AI code review)
  - SonarCloud (quality gate)
  - Snyk (security scan)
  - Vercel (preview deploy)
- Aggregate findings into `docs/testing/chunk-[id]-review-matrix.md`

### **PHASE 3: RESOLVE CI FEEDBACK (Sequential)**
- For each finding in review matrix:
  1. Read the issue comment on PR
  2. Apply the fix locally on feature branch
  3. Verify gates pass (`pnpm type-check && pnpm lint && pnpm build`)
  4. Commit with reference: `[Chunk X] Resolve [Tool] issue: [Description]`
  5. Push to origin
  6. Mark resolved in matrix (✅)
- Stop only when ALL matrix items are ✅

### **PHASE 4: CODERABBIT QUOTA MANAGEMENT**
**Constraint**: ~1-hour cooldown between CodeRabbit reviews

If stuck:
- Option A: Post comment on PR: `@CodeRabbitAI review`
- Option B: Push minor change to trigger new review window
- Option C: Escalate to CC if both fail

### **PHASE 5: FINAL APPROVAL & MERGE**
**Merge only when ALL conditions met:**
- [ ] All gates pass locally (type-check ✅ | lint ✅ | build ✅)
- [ ] All CI/CD checks green (CodeRabbit ✅ | Sonar ✅ | Snyk ✅)
- [ ] Review matrix complete (all items resolved ✅)
- [ ] No force-push history (clean linear commits)
- [ ] Commit messages atomic
- [ ] Git status clean
- [ ] Branch up-to-date with main
- [ ] Vercel preview deploy successful

**Merge command:**
```bash
git checkout main && git pull origin main
git merge --no-ff feature/chunk-[id]-[description]
git push origin main
git branch -d feature/chunk-[id]-[description]
git push origin --delete feature/chunk-[id]-[description]
```

### **PHASE 6: POST-MERGE DOCUMENTATION**
Update CLAUDE.md with:
```markdown
### [Chunk X] — [Feature Name]

**Status:** ✅ MERGED  
**Commit:** [hash]  
**Gates:**
- Type-check: ✅ 0 errors
- Lint: ✅ 0 violations
- Build: ✅ [Xs]
- CodeRabbit: ✅ [N] issues resolved
- Sonar: ✅ [N] violations resolved

**Dependencies:** [List chunks that follow]
**Entry point for next session:** [Exact command/context]
```

---

## Anti-Patterns (DO NOT DO)

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Multiple agents on same feature | Merge conflicts + unclear ownership | One agent per feature branch |
| Force-push main | Breaks history, CI chaos | Use --force-with-lease on feature branches only |
| Skipping local gates | CI catches issues after push (waste time) | Run gates locally before push |
| Ignoring CI/CD feedback | Tech debt + inconsistency | Resolve all matrix items sequentially |
| Generic commit messages | Lost context in CLAUDE.md | Use atomic format with gates + dependencies |
| Local sandbox work | "I'll push later" → lost code | Everything to GitHub immediately |

---

## Command Cheat Sheet

```bash
# Initialize feature
git checkout -b feature/chunk-[id]-[name]

# Local verification (before push)
pnpm type-check && pnpm lint && pnpm build

# Push & open PR
git push origin feature/chunk-[id]-[name]
# Then open PR on GitHub

# Fix CI issues
git commit -m "[Chunk X] Resolve [Tool] issue: [Description]"
git push origin feature/chunk-[id]-[name]

# Re-trigger CodeRabbit (if stuck)
# Post comment: @CodeRabbitAI review

# Merge (only when ALL gates ✅)
git checkout main && git pull origin main
git merge --no-ff feature/chunk-[id]-[name]
git push origin main
git branch -d feature/chunk-[id]-[name]
git push origin --delete feature/chunk-[id]-[name]
```

---

## When to Escalate

| Scenario | Escalate To | Action |
|---|---|---|
| **Build fails locally** | CC | Debug locally, don't push |
| **CI tool unavailable** | CCW | Pause feature, assess priority |
| **Merge conflict on main** | CC | Rebase feature branch cleanly |
| **CodeRabbit quota exhausted** | CC | Review code manually or skip if confident |
| **Code quality philosophically stuck** | CCW | Design review, clarify constraints |

---

## Key Rules

### ❌ NEVER
- Skip `/code-reviewer` or `/code-simplifier` audits (Phase 1)
- Merge code that doesn't pass local gates
- Force-push to main
- Ignore CI/CD feedback

### ✅ ALWAYS
- Run local triple-gate verification before pushing
- Resolve ALL CI findings before merge
- Commit atomically with gate status noted
- Update CLAUDE.md post-merge

---

## Canonical Source

**Memory Location**: `/home/kellyb_dev/.claude/projects/-home-kellyb-dev-projects-hex-yt-intel/memory/MULTI_AGENT_REVIEW_WORKFLOW.md` (306 lines)

**Project Symlink**: `/docs/reference/MULTI_AGENT_REVIEW_WORKFLOW.md`

**Access**: `/pr_review_workflow` skill (this document)

---

**Status: READY FOR EXECUTION**

This workflow scales from 1 agent to 7 agents with zero overlap. Each phase is sequential. Each gate is non-negotiable.

**Next step:** CC executes Phase 1 (local gates) for next feature chunk. Report back with gate status.
