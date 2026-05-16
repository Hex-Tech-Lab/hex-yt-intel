# MULTI-AGENT REVIEW WORKFLOW

## ⚠️ CANONICAL SOURCE LOCATION

**This document is maintained in the Claude Code memory system and accessed via the `/pr_review_workflow` skill.**

### For All Agents (CC, GC, KC, etc.)

Use the `/pr_review_workflow` skill to access the authoritative workflow specification:

```bash
/pr_review_workflow
```

This skill loads the canonical workflow from secure memory and displays it with full context.

### Canonical Location (CC Agent Reference)

**Memory Path**: `/home/kellyb_dev/.claude/projects/-home-kellyb-dev-projects-hex-yt-intel/memory/MULTI_AGENT_REVIEW_WORKFLOW.md`  
**File Size**: 306 lines  
**Last Updated**: 2026-05-16 23:30 UTC  
**Status**: Active, single source of truth

### Why Not Stored Here?

Symlinks to user-specific memory paths don't work across:
- Different machines (Windows/Mac/Linux)
- Different users
- Repository clones

The skill-based approach provides universal access while maintaining a single canonical version.

---

## Quick Reference

**6-Phase Workflow:**
1. **Local Isolation & Gates** — Feature branch + triple-gate verification (type-check, lint, build)
2. **GitHub PR & CI/CD Harvest** — Open PR, collect CodeRabbit/SonarCloud/Snyk feedback
3. **Resolve CI Feedback** — Apply fixes sequentially, re-verify gates
4. **CodeRabbit Quota Management** — Handle 1-hour cooldown, re-trigger if needed
5. **Final Approval & Merge** — Verify all conditions, merge to main
6. **Post-Merge Documentation** — Update CLAUDE.md with completion metadata

**Key Rules:**
- One agent per feature branch (no overlap)
- No upstream push until all local gates pass
- Resolve ALL CI feedback before merge
- Clean linear commit history

**Access the full specification**: `/pr_review_workflow` skill
