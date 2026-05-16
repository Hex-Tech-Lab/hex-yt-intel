---
Filename: MULTI_AGENT_REVIEW_WORKFLOW.md
Location: /docs/reference/
Version: v1.0.0
Build: 4b3ce22
Timestamp: Friday, 16 May 2026 at 23:15:00 EEST
Purpose: Authoritative workflow specification for multi-agent feature development | CANONICAL
---

# MULTI-AGENT REVIEW WORKFLOW — OPTIMIZED FOR HEX-YT-INTEL

**CANONICAL REFERENCE**: This is the single authoritative source for the multi-agent review workflow. All agents reference this document. Memory copies and skill implementations mirror this specification.

**TL;DR:** Feature branch → local gates → PR → harvest CI feedback → resolve → merge. One agent per feature. No overlap.

---

## **PHASE 1: LOCAL ISOLATION & GATES**

### **Agent: CC or GC (Whoever owns the feature)**

**Step 1: Feature Branch (Code Isolation)**
```bash
git checkout -b feature/chunk-[id]-[description]
# Example: feature/chunk-9-pdf-export
```

**Step 2: Local Triple-Gate Verification** (Non-negotiable)
```bash
pnpm type-check      # ✅ 0 TypeScript errors
pnpm lint            # ✅ 0 linting violations
pnpm build           # ✅ Production build completes
```

**Gate fail?** Stop. Fix locally. Commit atomically. Re-verify gates. **No upstream pushes until gates pass.**

**Step 3: Atomic Commit Message Format**
```
[Chunk X]: [Feature Name] ([Type])

- Bullet 1: What changed
- Bullet 2: Why it matters
- Bullet 3: Gate status (type-check ✅ | lint ✅ | build ✅)

Closes: #[PR_ID]
```

Example:
```
[Chunk 9]: PDF export + shareable links (Feature)

- Added /api/analyses/[id]/export (PDFKit generation)
- Added /share/[token] public page (read-only synthesis)
- Supabase columns: shared_token, shared_expires_at
- Gates: type-check ✅ | lint ✅ | build ✅ (180s)
```

**Step 4: Push to Feature Branch**
```bash
git push origin feature/chunk-[id]-[description]
```

---

## **PHASE 2: GITHUB PR & CI/CD HARVEST**

### **Agent: CC (PR Authority) + Automation Pipeline**

**Step 1: Open PR on GitHub**
- Base: `main`
- Head: `feature/chunk-[id]-[description]`
- Title: `[Chunk X] Feature Name`
- Description: Reference CLAUDE.md for context

**This triggers:**
- ✅ CodeRabbit (AI code review)
- ✅ SonarCloud (quality gate)
- ✅ Snyk (security scan)
- ✅ Vercel preview deploy

**Step 2: Harvest CI Feedback** (15-30 min window)

Wait for all 4 tools to report. Collect:
- CodeRabbit findings (inline comments + suggestions)
- SonarCloud issues (code quality, coverage)
- Snyk vulnerabilities (if any)
- Vercel build status

**Step 3: Aggregate Findings into Resolution Matrix**

Create `docs/testing/chunk-[id]-review-matrix.md`:

```markdown
# Chunk [X] Review Matrix

## CodeRabbit Findings (3 items)
- [ ] **Issue 1:** [Description] → **Fix:** [Patch]
- [ ] **Issue 2:** [Description] → **Fix:** [Patch]
- [ ] **Issue 3:** [Description] → **Fix:** [Patch]

## SonarCloud Violations (2 items)
- [ ] **Type:** Cognitive Complexity → **Fix:** Refactor function
- [ ] **Type:** Unused variable → **Fix:** Remove variable

## Snyk Alerts
- ✅ None

## Resolution Status
- CodeRabbit: 3/3 ✅
- Sonar: 2/2 ✅
- Snyk: 0/0 ✅
```

---

## **PHASE 3: RESOLVE CI FEEDBACK (Sequential)**

### **Agent: CC (Coding) + CCD/GC (Complex refactors)**

**For each item in review matrix:**

1. **Read the issue** (CodeRabbit/Sonar comment on PR)
2. **Apply the fix** (locally on feature branch)
3. **Verify gates pass** (`pnpm type-check && pnpm lint && pnpm build`)
4. **Commit with reference**
```bash
git commit -m "[Chunk X] Resolve CodeRabbit issue #1: [Description]"
git push origin feature/chunk-[id]-[description]
```

5. **Mark resolved in matrix** (✅)
6. **Move to next issue**

**Stop only when all matrix items are ✅.**

---

## **PHASE 4: CODERABBIT QUOTA MANAGEMENT**

### **The Constraint: CodeRabbit has ~1-hour cooldown between reviews**

**When stuck (CodeRabbit won't re-review):**

```bash
# Option A: Manual re-trigger (if you can comment)
# Post this comment on the PR:
@CodeRabbitAI review

# Option B: Wait & Push (if comment fails)
# Push a minor change → triggers new review window
git commit --allow-empty -m "[Chunk X] Trigger review cycle"
git push origin feature/chunk-[id]-[description]

# Option C: Escalate to CC (if both fail)
# CC has authority to force re-review or skip if convinced code is clean
```

**Quota tracking:**
- CodeRabbit: ~100 reviews/month on Pro tier
- SonarCloud: 10 analyses/day (stagger across features)
- Snyk: Unlimited

**Strategy:** Use CodeRabbit first (scarce), Sonar second (daily budget), Snyk always.

---

## **PHASE 5: FINAL APPROVAL & MERGE**

### **Agent: CC (Final Authority)**

**Merge only when ALL conditions met:**

- [ ] **All gates pass locally** (type-check ✅ | lint ✅ | build ✅)
- [ ] **All CI/CD checks green** (CodeRabbit ✅ | Sonar ✅ | Snyk ✅)
- [ ] **Review matrix complete** (all items resolved ✅)
- [ ] **No force-push history** (clean linear commits)
- [ ] **Commit messages atomic** (reference CLAUDE.md format)
- [ ] **Git status clean** (no uncommitted changes)
- [ ] **Branch up-to-date with main** (no stale merge conflicts)
- [ ] **Vercel preview deploy successful** (no runtime errors)

**Merge command:**
```bash
git checkout main
git pull origin main
git merge --no-ff feature/chunk-[id]-[description]
git push origin main
```

**Delete branch:**
```bash
git branch -d feature/chunk-[id]-[description]
git push origin --delete feature/chunk-[id]-[description]
```

---

## **PHASE 6: POST-MERGE DOCUMENTATION**

### **Agent: GC or CCW (Context Steward)**

**Update CLAUDE.md with:**

```markdown
### [Chunk X] — [Feature Name]

**Status:** ✅ MERGED  
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

## **ANTI-PATTERNS (DO NOT DO)**

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| **Multiple agents on same feature** | Merge conflicts + unclear ownership | One agent per feature branch |
| **Force-push main** | Breaks history, CI chaos | Use --force-with-lease on feature branches only |
| **Skipping local gates** | CI catches issues after push (waste time) | Run gates locally before push |
| **Ignoring CI/CD feedback** | Tech debt + inconsistency | Resolve all matrix items sequentially |
| **Generic commit messages** | Lost context in CLAUDE.md | Use atomic format with gates + dependencies |
| **Local sandbox work** | "I'll push later" → lost code | Everything to GitHub immediately |

---

## **COMMAND CHEAT SHEET**

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

# Update CLAUDE.md
# [Paste post-merge section above]
```

---

## **WHEN TO ESCALATE**

| Scenario | Escalate To | Action |
|---|---|---|
| **Build fails locally** | CC | Debug locally, don't push |
| **CI tool unavailable** | CCW | Pause feature, assess priority |
| **Merge conflict on main** | CC | Rebase feature branch cleanly |
| **CodeRabbit quota exhausted** | CC | Review code manually or skip if confident |
| **Code quality philosophically stuck** | CCW | Design review, clarify constraints |

---

**Status: READY FOR EXECUTION**

This workflow scales from 1 agent to 7 agents with zero overlap. Each phase is sequential. Each gate is non-negotiable.

**Next step:** CC executes Phase 1 (local gates) for next feature chunk. Report back with gate status.

---

## REFERENCES & MIRRORS

**Canonical Location**: `/docs/reference/MULTI_AGENT_REVIEW_WORKFLOW.md` (this file)

**Memory Mirrors** (for agent context during sessions):
- CC Memory: `/home/kellyb_dev/.claude/projects/-home-kellyb-dev-projects-hex-yt-intel/memory/pr_review_workflow.md`
- GC Memory: Refer to this document

**All agents should reference this canonical document. Updates made here are the source of truth.**
