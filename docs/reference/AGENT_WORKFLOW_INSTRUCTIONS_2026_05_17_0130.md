---
Filename: AGENT_WORKFLOW_INSTRUCTIONS.md
Location: /docs/reference/
Version: v1.0.0
Timestamp: Friday, 16 May 2026 at 23:40 EEST
Purpose: Safe, accurate workflow instructions for all agents (CC, GC, KC, GCW, etc.)
---

# WORKFLOW INSTRUCTIONS FOR ALL AGENTS

**READ THIS BEFORE STARTING ANY FEATURE WORK**

---

## DO NOT CREATE, MODIFY, OR WRITE ANY FILES

All documentation already exists. Your job is to follow it, not create it.

---

## WHEN YOU START FEATURE WORK

### Step 1: Read the Complete Workflow Specification

**File**: `/docs/reference/MULTI_AGENT_REVIEW_WORKFLOW.md`

Read this file FIRST. It contains the complete 6-phase workflow specification with all details, anti-patterns, and escalation paths.

**Do this FIRST. Read the entire file. Follow all 6 phases in order.**

---

### Step 2: Execute Phase 1 (Local Gates)

```bash
# Create feature branch
git checkout -b feature/chunk-[id]-[description]

# Run verification gates (ALL must pass)
pnpm type-check      # 0 TypeScript errors
pnpm lint            # 0 linting violations  
pnpm build           # Production build completes

# Commit atomically
git commit -m "[Chunk X]: [Feature Name] ([Type]) - Gates: type-check ✅ | lint ✅ | build ✅"

# Push to origin
git push origin feature/chunk-[id]-[description]
```

---

## ⚠️ CRITICAL: CC-EXCLUSIVE CODE REVIEW TOOLS

**These tools are ONLY available to CC (Claude Code):**
- `/code-reviewer` — Structural code review
- `/code-simplifier` — Code quality review

**If YOU are NOT CC:**

1. **STOP** (do not attempt to run these tools yourself)
2. **Call CC immediately** to run the audits
3. **If CC is unavailable**, escalate to the user
4. **NEVER proceed to Phase 2 without these audits** (Phase 1 gates include code review)

**CC will:**
- Run `/code-reviewer` and `/code-simplifier`
- Share findings with you
- You apply fixes and re-run gates
- Proceed to Phase 2 only after CC approves

---

## REFERENCE DOCUMENTS

**Complete workflow specification:**
- File: `/docs/reference/MULTI_AGENT_REVIEW_WORKFLOW.md`
- Access: Read-only reference (do not modify)
- Contains: All 6 phases, anti-patterns, command cheat sheet, escalation matrix

**This instruction file:**
- File: `/docs/reference/AGENT_WORKFLOW_INSTRUCTIONS.md`
- Purpose: Safe, minimal guidance for all agents
- Do NOT modify

---

## RULES (NON-NEGOTIABLE)

### ❌ DO NOT
- Create documentation files
- Modify CLAUDE.md, GEMINI.md, AGENTS.md
- Write new workflow guides
- Attempt to use `/code-reviewer` or `/code-simplifier` (unless you are CC)
- Proceed to Phase 2 without Phase 1 code review approval

### ✅ DO
- Invoke `/pr_review_workflow` at the start of feature work
- Follow all 6 phases sequentially
- Run local gates: type-check, lint, build
- Escalate code review to CC
- Read the full workflow specification before coding
- Commit atomically with gate status noted

---

## ESCALATION PATHS

| Blocker | Escalate To | Action |
|---|---|---|
| Need code review (not CC) | CC | Call CC to run `/code-reviewer` + `/code-simplifier` |
| CC unavailable | User | Advise user that code review is blocked, request manual review |
| Build fails locally | CC | Debug locally, do NOT push |
| CI tool unavailable | CCW | Pause feature, report status |
| Merge conflict on main | CC | Rebase feature branch cleanly |
| CodeRabbit quota exhausted | CC | Manual review or skip if confident |

---

## SUMMARY

1. **Invoke skill**: `/pr_review_workflow`
2. **Read output**: Complete 6-phase workflow
3. **Execute Phase 1**: Local gates + code review (CC-gated)
4. **Follow Phases 2-6**: As specified in skill output
5. **Escalate code review to CC**: Non-negotiable
6. **Never create files**: All docs exist

---

**Status**: AUTHORITATIVE | All agents | Read-only reference  
**Last Updated**: 2026-05-16 23:40 EEST  
**Compliance**: MANDATORY
