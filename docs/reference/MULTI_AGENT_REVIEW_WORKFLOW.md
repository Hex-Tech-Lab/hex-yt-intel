---
title: Multi-Agent Review Workflow
description: Standardized 6-phase review and merge pipeline for hex-yt-intel feature development
updated: 2026-05-16
status: active
---

# MULTI-AGENT REVIEW WORKFLOW — HEX-YT-INTEL

**TL;DR:** Feature branch → local gates → PR → harvest CI feedback → resolve → merge. One agent per feature. No overlap.

---

## PHASE 1: LOCAL ISOLATION & GATES

**Agent: CC or GC (Whoever owns the feature)**

### Step 1: Feature Branch (Code Isolation)

```bash
git checkout -b feature/chunk-[id]-[description]
# Example: feature/chunk-9-pdf-export
```

### Step 2: Local Triple-Gate Verification (Non-negotiable)

```bash
pnpm type-check      # 0 TypeScript errors
pnpm lint            # 0 linting violations
pnpm build           # Production build completes
```

**Gate fail?** Stop. Fix locally. Commit atomically. Re-verify gates. No upstream pushes until gates pass.

### Step 3: Atomic Commit Message Format

```
[Chunk X]: [Feature Name] ([Type])

- Bullet 1: What changed
- Bullet 2: Why it matters
- Bullet 3: Gate status (type-check ✅ | lint ✅ | build ✅)

Closes: #[PR_ID]
```

### Step 4: Push to Feature Branch

```bash
git push origin feature/chunk-[id]-[description]
```

---

## PHASE 2: GITHUB PR & CI/CD HARVEST

**Agent: CC (PR Authority) + Automation Pipeline**

### Step 1: Open PR on GitHub

- Base: `main`
- Head: `feature/chunk-[id]-[description]`
- Title: `[Chunk X] Feature Name`
- Description: Reference AGENTS.md for context

This triggers automated review tooling:
- CodeRabbit (AI code review)
- SonarCloud (quality gate)
- Snyk (security scan)
- Vercel preview deploy

### Step 2: Harvest CI Feedback (15-30 min window)

Wait for all tools to report. Collect:
- CodeRabbit findings (inline comments + suggestions)
- SonarCloud issues (code quality, coverage)
- Snyk vulnerabilities (if any)
- Vercel build status

### Step 3: Aggregate Findings into Resolution Matrix

Create `docs/testing/chunk-[id]-review-matrix.md`:

```markdown
# Chunk [X] Review Matrix

## CodeRabbit Findings (N items)
- [ ] **Issue 1:** [Description] → **Fix:** [Patch]
- [ ] **Issue 2:** [Description] → **Fix:** [Patch]

## SonarCloud Violations (N items)
- [ ] **Type:** [Violation] → **Fix:** [Patch]

## Snyk Alerts
- None / [Findings]

## Resolution Status
- CodeRabbit: N/N ✅
- Sonar: N/N ✅
- Snyk: N/N ✅
```

---

## PHASE 3: RESOLVE CI FEEDBACK (Sequential)

**Agent: CC (Coding) + GC (Complex refactors)**

For each item in review matrix:

1. Read the issue (CodeRabbit/Sonar comment on PR)
2. Apply the fix (locally on feature branch)
3. Verify gates pass: `pnpm type-check && pnpm lint && pnpm build`
4. Commit with reference:
   ```bash
   git commit -m "[Chunk X] Resolve [Tool] issue #[N]: [Description]"
   git push origin feature/chunk-[id]-[description]
   ```
5. Mark resolved in matrix (✅)
6. Move to next issue

Stop only when all matrix items are ✅.

---

## PHASE 4: CODERABBIT QUOTA MANAGEMENT

CodeRabbit has ~1-hour cooldown between reviews.

### When stuck (CodeRabbit won't re-review):

**Option A:** Manual re-trigger — post on PR:
```
@CodeRabbitAI review
```

**Option B:** Wait & Push — push minor change to trigger new review window:
```bash
git commit --allow-empty -m "[Chunk X] Trigger review cycle"
git push origin feature/chunk-[id]-[description]
```

**Option C:** Escalate to CC — force re-review or skip if convinced code is clean.

### Quota tracking:
- CodeRabbit: ~100 reviews/month on Pro tier (scarce — use first)
- SonarCloud: 10 analyses/day (stagger across features)
- Snyk: Unlimited (always run)

---

## PHASE 5: FINAL APPROVAL & MERGE

**Agent: CC (Final Authority)**

Merge only when ALL conditions met:

- [ ] All gates pass locally (type-check ✅ | lint ✅ | build ✅)
- [ ] All CI/CD checks green (CodeRabbit ✅ | Sonar ✅ | Snyk ✅)
- [ ] Review matrix complete (all items resolved ✅)
- [ ] No force-push history (clean linear commits)
- [ ] Commit messages atomic (reference AGENTS.md format)
- [ ] Git status clean (no uncommitted changes)
- [ ] Branch up-to-date with main (no stale merge conflicts)
- [ ] Vercel preview deploy successful (no runtime errors)

### Merge command:

```bash
git checkout main
git pull origin main
git merge --no-ff feature/chunk-[id]-[description]
git push origin main
```

### Delete branch:

```bash
git branch -d feature/chunk-[id]-[description]
git push origin --delete feature/chunk-[id]-[description]
```

---

## PHASE 6: POST-MERGE DOCUMENTATION

**Agent: GC (Context Steward)**

Update AGENTS.md or relevant handover log with:

```markdown
### [Chunk X] — [Feature Name]

**Status:** MERGED
**Commit:** [hash]
**Branch:** feature/chunk-[id]-[description] (deleted)
**Timeline:** [start] → [end] ([Xh Xm])

**What changed:**
- [Bullet 1]
- [Bullet 2]
- [Bullet 3]

**Gates:**
- Type-check: ✅ 0 errors
- Lint: ✅ 0 violations
- Build: ✅ [Xs]
- CodeRabbit: ✅ [N] issues resolved
- Sonar: ✅ [N] violations resolved

**Dependencies:** [Chunks that follow depend on this]

**Entry point for next session:** [Exact command/context to resume]
```

---

## CC-ONLY SKILL GUARDRAIL

> The following skills are **exclusively owned by CC** (Claude Code CLI). No other agent — not GC, not KC, not GCW — may invoke these directly. They are available only inside CC's own agent loop.

| Skill | Purpose | Owner |
|---|---|---|
| `/code-reviewer` | Structural code review (architecture, types, breaking changes) | **CC only** |
| `/code-simplifier` | Code quality review (duplication, efficiency, readability) | **CC only** |

### What non-CC agents must do when review is required:

1. **Call CC immediately** — ask CC to run the appropriate skill from within its own session
2. **Do NOT proceed** without these audits passing
3. **If CC is unavailable**, escalate to the user — do not attempt to fill the gap

Non-CC agents implementing Phase 3 (Resolve CI Feedback) must route all code-review refactors through CC via the skills above. CC applies the fixes, re-verifies gates, commits, and pushes — then reports back.

---

## ANTI-PATTERNS (DO NOT DO)

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Multiple agents on same feature | Merge conflicts + unclear ownership | One agent per feature branch |
| Force-push main | Breaks history, CI chaos | `--force-with-lease` on feature branches only |
| Skipping local gates | CI catches issues after push (waste time) | Run gates locally before push |
| Ignoring CI/CD feedback | Tech debt + inconsistency | Resolve all matrix items sequentially |
| Generic commit messages | Lost context in AGENTS.md | Use atomic format with gates + dependencies |
| Local sandbox work | "I'll push later" → lost code | Everything to GitHub immediately |
| Non-CC agent running /code-reviewer or /code-simplifier | Skills are CC-only — results will be inconsistent or unavailable | Escalate to CC |

---

## COMMAND CHEAT SHEET

```bash
# Initialize feature
git checkout -b feature/chunk-[id]-[name]

# Local verification (before push)
pnpm type-check && pnpm lint && pnpm build

# Push & open PR
git push origin feature/chunk-[id]-[name]
# Then open PR on GitHub

# Fix CI issues
git commit -m "[Chunk X] Resolve [Tool] issue #[N]: [Description]"
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

## WHEN TO ESCALATE

| Scenario | Escalate To | Action |
|---|---|---|
| Build fails locally | CC | Debug locally, don't push |
| CI tool unavailable | CCW | Pause feature, assess priority |
| Merge conflict on main | CC | Rebase feature branch cleanly |
| CodeRabbit quota exhausted | CC | Review code manually or skip if confident |
| Code quality philosophically stuck | CCW | Design review, clarify constraints |
| Non-CC agent needs code review | CC | Ask CC to invoke /code-reviewer or /code-simplifier |

---

## MANDATORY TRIGGER: `/pr_review_workflow`

**When starting ANY feature work, invoke `/pr_review_workflow` to display the complete specification across the team.**

Follow all 6 phases in order from the displayed spec. The spec is authoritative over any lingering assumptions.
