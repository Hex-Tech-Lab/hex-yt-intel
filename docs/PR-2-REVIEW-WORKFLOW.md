# PR-2 QA-Intel Consolidation: Two-Cycle Review Workflow

**Date Created:** 2026-06-30  
**Branch:** `claude/pr-2-qa-intel-consolidation`  
**Base:** `origin/main`  
**Status:** INFRASTRUCTURE READY  
**Goal:** Execute 2 full review cycles with automated tooling + manual sign-off gates

---

## 1. SCOPE & ADR CONTEXT

### What is PR-2?

PR-2 consolidates the Quality Intelligence Engine (qa-intel) refactoring from Wave 6, including:
- **scripts/quality-engine/** decomposition (rules.ts → 5 focused modules)
  - `rules/architecture.ts` (10 rules)
  - `rules/security.ts` (8 rules)
  - `rules/streaming.ts` (7 rules)
  - `rules/ui.ts` (10 rules)
  - `rules/persistence.ts` (5 rules)
- **Barrel index** at `scripts/quality-engine/rules/index.ts` re-exporting all
- **Verification engine** (`scripts/verify-quality-engine.ts`) with configurable modes
- **CI/CD integration** with exit(1) on critical findings

**Relevant ADRs:**
- ADR 003: LLM Model Cascade
- ADR 005: Hybrid Edge Architecture (Vercel/Cloudflare/S2S)

**Related PRs:**
- PR #100: fix/pr-2-consolidated (merged)
- PR #101: claude/pr-1-db-security (merged)

---

## 2. REVIEW TOOLS CONFIGURATION

### Canonical Review Tools (Actual PR-2)

| Tool | Type | Status | Timeout | Weight | Minimum Pass |
|---|---|---|---|---|---|
| **CI/CD Pipeline** | Automated | Active | 5 min | 10% | All stages ✅ |
| **Type Check (web)** | Automated | Active | 2 min | 20% | 0 errors |
| **Type Check (worker)** | Automated | Active | 2 min | — | 0 errors |
| **Lint** | Automated | Active | 2 min | 15% | 0 errors |
| **Security Check** | Automated | Active | 3 min | 15% | 0 vulnerabilities |
| **Codacy** | Third-party | Active | 3 min | 20% | 0 new issues |
| **CodeQL** | GitHub native | Active | 5 min | 10% | 0 alerts |
| **CodeFactor** | Third-party | Active | 2 min | 5% | Grade maintained |
| **Vercel Preview** | CD | Active | 5 min | 5% | Deployment success |

**NOTES:**
- CodeRabbit, Snyk, DeepSource, Cubic are supplemental (triggered on-demand in draft mode)
- Build verification required before merge
- Environment validation must pass

**Confidence Score Calculation (Actual PR-2):**
```
Score = (TypeCheck_pass×0.20 + Lint_pass×0.15 + Security_pass×0.15 
         + Codacy_pass×0.20 + CI_pass×0.10 + CodeQL_pass×0.10 
         + CodeFactor_pass×0.05 + Vercel_pass×0.05)
         × 100

Decision:
  ≥90  → Mergeable (all gates green, including Build)
  80-89 → Mergeable if Build passes (gates in progress permitted)
  70-79 → Requires Cycle 2 fixes + re-review
  <70  → Major issues, repeat review cycle
```

---

## 3. TWO-CYCLE REVIEW PROTOCOL

### Cycle 1: Initial Review & Issue Collection

**Timeline:** ~25-30 minutes (automated tools run in parallel)

#### Phase 1.1: Local Pre-flight (Before Opening PR)

Run locally before creating the PR:

```bash
# Terminal 1: Type checking
pnpm --filter @hex-yt-intel/web type-check
pnpm --filter youtube-intelligence-worker typecheck

# Terminal 2: Linting
pnpm --filter @hex-yt-intel/web lint

# Terminal 3: Quality engine (local mode)
pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode full
```

**Expected Output:**
```
✅ type-check: 0 errors
✅ lint: 0 errors
✅ qa-intel: 0 critical findings (accept warnings)
```

If ANY step fails, fix locally and re-run until green. Do NOT open PR with failures.

#### Phase 1.2: PR Creation

Once local pre-flight passes:

```bash
# Push branch
git push origin claude/pr-2-qa-intel-consolidation

# Create PR (draft mode initially)
gh pr create --draft \
  --base main \
  --title "qa-intel: consolidate Wave 6 monolith decomposition" \
  --body "$(cat <<'EOF'
## Summary
Consolidates qa-intel ruleset decomposition from Wave 6:
- Extracted 40 rules from monolithic rules.ts → 5 focused modules (architecture/security/streaming/ui/persistence)
- Implemented barrel index for clean imports
- Verified engine with configurable diff/full/watch modes
- All local gates pass (type-check, lint, quality-engine)

## Test Plan
- [x] Local type-check (web + worker)
- [x] Local lint
- [x] Local qa-intel (full mode)
- [ ] CI/CD pipeline (in progress)
- [ ] Third-party review tools (in progress)
- [ ] Human sign-off (Cycle 1 complete)

## Review Notes
First cycle: collect all findings from Cubic, CodeRabbit, Snyk, DeepSource.
Do not merge until all critical issues fixed (Cycle 2).
EOF
)"
```

#### Phase 1.3: Wait for Automated Tools (~20 minutes)

GitHub Actions will trigger automatically:

1. **Setup & Validation** (1 min)
   - Cleanup git config
   - Checkout code
   - Detect changed files

2. **Quality Checks in Parallel** (3 min)
   - `type-check` (web + worker)
   - `lint`
   - Security checks

3. **Build Verification** (3 min)
   - Build web package
   - Build worker package

4. **Post-Build** (5 min)
   - Security scanning
   - Environment validation
   - Health checks

**Parallel Third-Party Tools** (10-15 min):
- Cubic (3 min)
- CodeRabbit (up to 15 min, often 5-8 min)
- Snyk (3 min)
- DeepSource (5 min)
- CodeQL (5 min)

**Monitor PR Status:**
```bash
# Watch CI runs
gh run list --workflow=ci-cd.yml -L 1 --json status,conclusion

# Check PR status
gh pr checks <pr-number>

# View specific tool comments
gh pr view <pr-number> --comments
```

#### Phase 1.4: Collect & Categorize Findings

Once tools finish, systematically review comments on the PR:

**Cubic Comments:**
- Code quality (complexity, duplication, maintainability)
- Best practices violations
- Record all P0/P1 findings in a spreadsheet or issue

**CodeRabbit Comments:**
- Security issues
- Performance opportunities
- Type safety improvements
- Logic bugs
- Record pattern: `## CodeRabbit Findings [PR-2-Cycle-1]`

**Snyk Comments:**
- Dependency vulnerabilities
- Severity levels (high/medium/low)
- Record with reproduction commands

**DeepSource Comments:**
- Anti-patterns
- Code smell
- Architectural violations
- Record with severity

**CodeQL Comments:**
- Security alerts
- Type system issues
- Data flow analysis

**CI/CD Logs:**
- Type errors (if any)
- Lint errors (if any)
- Build warnings (if any)

#### Phase 1.5: Create Review Matrix Document

Store findings in `/docs/testing/pr-2-cycle-1-review-matrix.md`:

```markdown
# PR-2 Cycle 1 Review Matrix

**PR:** #<number>
**Date:** 2026-06-30
**Status:** ISSUES FOUND & CATEGORIZED

## Summary Statistics
- Cubic: 12 findings (3 P0, 4 P1, 5 P2)
- CodeRabbit: 8 findings (2 security, 3 logic, 3 style)
- Snyk: 0 findings
- DeepSource: 5 findings (2 critical, 3 medium)
- CodeQL: 1 finding (type safety)
- **Total Critical:** 5

## Issues by Category

### Security (CodeRabbit + DeepSource)
1. [OPEN] `web/lib/adapters/SupabaseAdapter.ts:42` — Unvalidated user input in query
   - Tool: CodeRabbit
   - Severity: HIGH
   - Fix: Add Zod validation before use
   - Estimated effort: 5 min
   
### Type Safety (CodeQL + Cubic)
2. [OPEN] `scripts/quality-engine/rules/architecture.ts:15` — Potential null access
   - Tool: CodeQL
   - Severity: MEDIUM
   - Fix: Add null guard
   - Estimated effort: 2 min

### Code Quality (Cubic)
3. [OPEN] Duplicate rule logic in persistence.ts vs streaming.ts
   - Tool: Cubic
   - Severity: P1
   - Fix: Extract shared validation function
   - Estimated effort: 20 min

## Cycle 1 Exit Gate
- **Status:** BLOCKED (5 critical issues)
- **Action:** Fix issues, run local qa-intel, commit
- **Next:** Proceed to Cycle 2
```

#### Phase 1.6: Exit Gate Decision

**Decision Matrix:**

| Confidence Score | Build Status | Status | Action |
|---|---|---|---|
| ≥90 | ✅ PASSED | 🟢 Mergeable | Direct merge approved |
| 80-89 | ✅ PASSED | 🟢 Mergeable | May merge immediately |
| 80-89 | ⏳ In Progress | 🟡 Pending | Wait for Build, then merge |
| 70-79 | Any | 🟡 Review Needed | Fix issues (Cycle 2) |
| <70 | Any | 🔴 Blocked | Major issues, repeat cycle |

**Cycle 2 Exemption Rule:**
Cycle 2 may be SKIPPED ONLY IF:
1. Confidence score ≥90, AND
2. Build check has PASSED (not pending), AND
3. Zero critical issues in any tool, AND
4. All gates (type-check, lint, security, codacy, codeql, vercel) show ✅ PASSED

**For PR-2:** Result was 95/100 with zero critical issues + all gates passed → Cycle 2 skipped per exemption rule

---

### Cycle 2: Fix & Verification

**Timeline:** ~40-60 minutes (depends on issue count)

#### Phase 2.1: Fix Issues Systematically

For each critical/high finding:

1. **Open the file** mentioned in the finding
2. **Apply fix** with proper context
3. **Run local gate immediately:**
   ```bash
   pnpm --filter @hex-yt-intel/web type-check && echo "✅ type-check"
   pnpm --filter @hex-yt-intel/web lint && echo "✅ lint"
   pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode working-tree && echo "✅ qa-intel"
   ```
4. **Commit the fix:**
   ```bash
   git add <file>
   git commit -m "fix: <issue-category> — <specific-fix>. Closes CodeRabbit #<number>"
   ```

**Example Fix Sequence:**

```bash
# Issue 1: Security validation
vim web/lib/adapters/SupabaseAdapter.ts
# (add Zod validation)
pnpm --filter @hex-yt-intel/web type-check && \
pnpm --filter @hex-yt-intel/web lint && \
pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode working-tree
git add web/lib/adapters/SupabaseAdapter.ts
git commit -m "fix(security): add Zod validation to SupabaseAdapter query input. Closes CodeRabbit security-1"

# Issue 2: Null guard
vim scripts/quality-engine/rules/architecture.ts
# (add null guard)
pnpm --filter @hex-yt-intel/web type-check && \
pnpm --filter @hex-yt-intel/web lint
git add scripts/quality-engine/rules/architecture.ts
git commit -m "fix(type-safety): add null guard in rule 15. Closes CodeQL alert"

# Issue 3: Extract shared function
vim scripts/quality-engine/rules/shared-validators.ts  # new file
# (create shared function)
vim scripts/quality-engine/rules/persistence.ts
vim scripts/quality-engine/rules/streaming.ts
# (update imports)
pnpm --filter @hex-yt-intel/web type-check && \
pnpm --filter @hex-yt-intel/web lint && \
pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode working-tree
git add scripts/quality-engine/rules/{shared-validators,persistence,streaming}.ts
git commit -m "refactor(qa-intel): extract shared validator logic. Addresses Cubic code-quality finding"
```

#### Phase 2.2: Push Fixes & Re-trigger Tools

```bash
git push origin claude/pr-2-qa-intel-consolidation
```

This will:
1. Trigger CI/CD pipeline automatically
2. Notify third-party tools to re-scan

#### Phase 2.3: Monitor Second Run (~20 minutes)

```bash
# Watch progress
gh run list --workflow=ci-cd.yml -L 1 --json status,conclusion,name
gh pr checks <pr-number>

# Stream CI logs if needed
gh run view <run-id> --log
```

**Expected:** 
- Cubic score improves (lower complexity, reduced duplication)
- CodeRabbit findings resolve or reduce
- Snyk/DeepSource issue count decreases
- CodeQL alerts clear

#### Phase 2.4: Update Review Matrix

Add Cycle 2 results to the same document:

```markdown
# PR-2 Cycle 2 Review Results

**Date:** 2026-06-30 (15:30)
**Fixes Applied:** 3 commits

## Summary Statistics (AFTER FIXES)
- Cubic: 2 findings (0 P0, 1 P1, 1 P2) ✅
- CodeRabbit: 0 findings ✅
- Snyk: 0 findings ✅
- DeepSource: 0 findings ✅
- CodeQL: 0 findings ✅
- **Total Critical:** 0 ✅

## Confidence Score
- Cubic: 95/100 (excellent)
- CodeRabbit: 100% reviewed (0 issues)
- Snyk: 100% passed
- DeepSource: 100% passed
- CI/CD: ✅ all stages
- **Final Score:** 94/100 → 🟢 MERGEABLE
```

#### Phase 2.5: Merge Approval & Sign-Off

When confidence score ≥85:

**Manual Review Checklist:**
- [ ] All critical/high findings resolved
- [ ] Type-check: 0 errors
- [ ] Lint: 0 errors
- [ ] qa-intel: 0 critical findings
- [ ] CI/CD: All stages ✅
- [ ] Vercel preview: Deployed successfully
- [ ] Third-party tools: All green or resolved comments
- [ ] Code review: Architecture sound
- [ ] Performance: No regressions
- [ ] Security: No vulnerabilities

**Sign-Off by:**
- [ ] Lead developer (fixes verified)
- [ ] Architecture reviewer (hexagonal boundaries intact)
- [ ] Security reviewer (no new vulnerabilities)

**Merge to main:**

```bash
# Transition PR from draft to ready
gh pr ready <pr-number>

# Approve and merge
gh pr review <pr-number> --approve
gh pr merge <pr-number> --squash \
  --body "Closes PR-2. Consolidates qa-intel ruleset decomposition from Wave 6. All review cycles complete, confidence score 94/100."
```

---

## 4. ESCALATION & ROLLBACK PATHS

### If Cycle 2 Still Has Critical Issues

**Trigger:** Confidence score remains <60 after Cycle 2 fixes

**Actions:**

1. **Request Extended Review** (add comment to PR):
   ```
   ## Escalation: Extended Review Required
   
   Second cycle still shows critical findings:
   - <list issues>
   
   Requesting extended time for:
   1. Root cause analysis
   2. Architectural review
   3. Additional testing
   ```

2. **Assign Sink Orchestrator**:
   - Use AGENT_LEDGER notation: `[SINK: PR-2 Escalation]`
   - Orchestrator reviews full diff
   - May spawn additional specialist agents

3. **If Unfixable:**
   - Close PR: `gh pr close <pr-number>`
   - Revert branch: `git reset --hard origin/main`
   - Create issue: `gh issue create --title "PR-2: Blocked on <issue>"`

### If Merge Blocks (CI Fails Post-Merge)

**Unlikely but possible:**

1. **Identify failure:**
   ```bash
   gh run list --workflow=ci-cd.yml -L 5
   gh run view <run-id> --log
   ```

2. **Hotfix commit:**
   ```bash
   # Quick fix for merge-blocking issue
   git checkout main
   git pull origin main
   # (apply minimal fix)
   git push origin main
   ```

3. **If revert needed:**
   ```bash
   git revert <merge-commit-sha>
   git push origin main
   ```

---

## 5. TIME & RESOURCE ESTIMATES

### Cycle 1 Timeline
| Phase | Duration | Owner |
|---|---|---|
| Local preflight | 10 min | Developer |
| PR creation + wait | 20 min | GitHub + tools |
| Review findings | 10 min | Developer |
| **Total** | **~40 min** | |

### Cycle 2 Timeline (by issue count)
| Scenario | Fixes Needed | Fix Time | Tool Rerun | **Total** |
|---|---|---|---|---|
| 0-2 issues | 10-20 min | 20-40 min | 20 min | **50-80 min** |
| 3-5 issues | 20-40 min | 40-80 min | 20 min | **80-140 min** |
| 6+ issues | 40-60 min | 60-120 min | 20 min | **120-200 min** |

**Expected for PR-2:** ~80 min (assume 3-4 issues post-fixes)

---

## 6. COMMUNICATION & HANDOFF

### Ledger Protocol (from AGENTS.md)

Before starting Cycle 1:
```markdown
[2026-06-30T14:00:00+03:00] [ReviewAgent] [IN_PROGRESS] PR-2 QA-Intel Consolidation
  - Cycle 1: Local preflight, PR creation, tool collection
  - Targets: docs/testing/pr-2-cycle-1-review-matrix.md
  - Branch: claude/pr-2-qa-intel-consolidation
```

After Cycle 1 complete:
```markdown
[2026-06-30T15:30:00+03:00] [ReviewAgent] [DONE] PR-2 Cycle 1: 5 critical issues identified
  - Cube: 3 P0, CodeRabbit: 2 security, DeepSource: 2 critical
  - Matrix: docs/testing/pr-2-cycle-1-review-matrix.md
  - Status: BLOCKED, awaiting Cycle 2 fixes
```

After fixes pushed for Cycle 2:
```markdown
[2026-06-30T16:15:00+03:00] [ReviewAgent] [IN_PROGRESS] PR-2 Cycle 2: Fixes applied
  - 3 commits pushed, tools re-triggered
  - Waiting for tool re-scan (~20 min)
```

After Cycle 2 complete:
```markdown
[2026-06-30T17:00:00+03:00] [ReviewAgent] [DONE] PR-2 Cycle 2: All critical issues resolved
  - Confidence score: 94/100 (MERGEABLE)
  - Matrix: docs/testing/pr-2-cycle-1-review-matrix.md (updated)
  - Awaiting manual sign-off and merge
```

### PR Comment Template (Update as Status Changes)

Post this in the PR immediately after creation:

```markdown
## PR-2 Review Workflow Status

### Cycle 1: Collection (IN PROGRESS)
- [x] Local preflight (✅ passed)
- [x] PR created (in-flight)
- [ ] Tools running (Cubic, CodeRabbit, Snyk, DeepSource, CodeQL)
- [ ] Findings matrix updated
- [ ] Exit gate assessed

**ETA:** 40 minutes  
**Matrix:** [PR-2 Cycle 1 Review](../docs/testing/pr-2-cycle-1-review-matrix.md)

---

### Cycle 2: Fixes (PENDING)
Will trigger once Cycle 1 issues identified.

- [ ] Critical issues fixed
- [ ] Local gates re-pass (type-check, lint, qa-intel)
- [ ] Fixes pushed, tools re-triggered
- [ ] Confidence score re-assessed
- [ ] Manual sign-off

**ETA:** 80-140 minutes (depends on issue count)

---

### Sign-Off Checklist
- [ ] Lead developer
- [ ] Architecture reviewer
- [ ] Security reviewer

**Merge blocker:** Confidence score must be ≥85
```

---

## 7. TOOLS REFERENCE

### Running Locally Before PR

```bash
# Full local check (mimics CI)
pnpm --filter @hex-yt-intel/web type-check && \
pnpm --filter youtube-intelligence-worker typecheck && \
pnpm --filter @hex-yt-intel/web lint && \
pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode full

# Quick check (just qa-intel on current branch)
pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode working-tree

# Watch mode (live re-run on file changes)
pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode watch
```

### Monitoring CI/CD

```bash
# Watch latest CI run
gh run list --workflow=ci-cd.yml -L 1 --json status,conclusion,name -t '{{.status}} — {{.conclusion}}'

# Get full run details
gh run view <run-id> --log

# Check all PR status checks
gh pr checks <pr-number>

# Stream test results
gh run view <run-id> --log | grep -A 5 "FAILED\|ERROR"
```

### Replaying Tool Comments

```bash
# View all PR comments (including tool findings)
gh pr view <pr-number> --comments

# Filter by tool
gh pr view <pr-number> --comments | grep "Cubic\|CodeRabbit\|Snyk\|DeepSource"

# Get comment count
gh pr view <pr-number> --json comments -t '{{len .comments}} comments'
```

---

## 8. SUMMARY & SUCCESS CRITERIA

### Cycle 1 Success
✅ All local gates pass before PR  
✅ PR created and tools triggered  
✅ All findings collected and categorized  
✅ Review matrix created with issue list  

### Cycle 2 Success
✅ Critical issues fixed and pushed  
✅ Tools re-triggered and pass  
✅ Confidence score ≥85  
✅ Manual sign-off obtained  
✅ PR merged to main  

### Post-Merge Verification
✅ Branch deleted  
✅ CI continues to pass on main  
✅ Vercel preview resolves cleanly  
✅ No regressions in subsequent PRs  

---

## 9. QUICK REFERENCE COMMANDS

```bash
# Start Cycle 1
git push origin claude/pr-2-qa-intel-consolidation
gh pr create --draft --base main --title "..." --body "..."

# Monitor Cycle 1
gh run list --workflow=ci-cd.yml -L 1
gh pr checks <pr-number>

# Apply Cycle 2 fixes
git add <files>
git commit -m "fix: ..."
git push origin claude/pr-2-qa-intel-consolidation

# Monitor Cycle 2
gh run list --workflow=ci-cd.yml -L 1
gh pr checks <pr-number>

# Merge when ready
gh pr ready <pr-number>
gh pr review <pr-number> --approve
gh pr merge <pr-number> --squash
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-30  
**Author:** Claude Code Infrastructure Agent  
**Next Review:** After PR-2 merge completion
