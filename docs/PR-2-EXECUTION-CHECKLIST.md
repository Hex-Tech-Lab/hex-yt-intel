# PR-2 QA-Intel Consolidation: Execution Checklist

**Quick Reference for PR-2 Review Cycle Execution**

---

## PRE-LAUNCH: Setup (Do Before Creating PR)

```bash
# Terminal 1: Web type-check
[ ] pnpm --filter @hex-yt-intel/web type-check
    Expected: ✅ Type-check passed (0 errors)

# Terminal 2: Worker type-check
[ ] pnpm --filter youtube-intelligence-worker typecheck
    Expected: ✅ TypeCheck passed (0 errors)

# Terminal 3: Lint
[ ] pnpm --filter @hex-yt-intel/web lint
    Expected: ✅ Lint passed (0 errors)

# Terminal 4: Quality engine
[ ] pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode full
    Expected: ✅ 0 critical findings

# Commit status
[ ] git status
    Expected: ✅ clean (no uncommitted changes)
```

**If ANY fail:** Fix locally, re-run until all green.

---

## CYCLE 1: Initial Review & Collection

### Phase 1.1: Create PR

```bash
# Push branch
[ ] git push origin claude/pr-2-qa-intel-consolidation
    Expected: ✅ pushed to origin

# Create draft PR
[ ] gh pr create --draft \
      --base main \
      --title "qa-intel: consolidate Wave 6 monolith decomposition" \
      --body "<copy from PR-2-REVIEW-WORKFLOW.md section 3.2>"
    
    Expected: ✅ PR created (note PR number)

# Record PR number
    PR #: _______

# Mark ready when confident
[ ] gh pr ready <pr-number>
    (Wait for all local tests to pass in Cycle 1 first)
```

### Phase 1.2: Monitor Tools (~20 minutes)

**Automated Tools Checklist:**

```
GitHub Actions (CI/CD)
  [ ] Setup & Validation — ✅ PASS
  [ ] Type-Check (web) — ✅ PASS (0 errors)
  [ ] Type-Check (worker) — ✅ PASS (0 errors)
  [ ] Lint — ✅ PASS (0 errors)
  [ ] Build — ✅ PASS
  [ ] Security Check — ✅ PASS
  [ ] Env Validation — ✅ PASS
  [ ] Final Status — ✅ PASS

Parallel Tools (wait 15 min max)
  [ ] Cubic — ✅ Comment posted (score: ___/100)
  [ ] CodeRabbit — ✅ Comment posted (issues: ___)
  [ ] Snyk — ✅ Comment posted (vulnerabilities: ___)
  [ ] DeepSource — ✅ Comment posted (issues: ___)
  [ ] CodeQL — ✅ Comment posted (alerts: ___)
```

**Check Status:**
```bash
[ ] gh pr checks <pr-number>
    Expected: ✅ All showing passing or with comments
```

### Phase 1.3: Collect Findings

For each tool comment on the PR:

**Cubic:**
```
[ ] Read Cubic comment
    Findings: 
    - Issue 1: ___________
    - Issue 2: ___________
    Priority (P0/P1/P2): ___
```

**CodeRabbit:**
```
[ ] Read CodeRabbit comment(s)
    Findings:
    - Security issue: ___________
    - Logic issue: ___________
    - Style issue: ___________
```

**Snyk:**
```
[ ] Read Snyk comment
    Vulnerabilities:
    - High: ___
    - Medium: ___
    - Low: ___
```

**DeepSource:**
```
[ ] Read DeepSource comment
    Issues:
    - Critical: ___
    - Major: ___
    - Minor: ___
```

**CodeQL:**
```
[ ] Read CodeQL comment
    Alerts:
    - Type safety: ___
    - Security: ___
```

### Phase 1.4: Create Review Matrix

```bash
[ ] Create file: docs/testing/pr-2-cycle-1-review-matrix.md
    
    Content template:
    # PR-2 Cycle 1 Review Matrix
    
    **Date:** 2026-06-30
    **PR:** #<number>
    **Tools Status:**
    - Cubic: ✅ <score>/100
    - CodeRabbit: ✅ <count> issues
    - Snyk: ✅ <count> vulnerabilities
    - DeepSource: ✅ <count> issues
    - CodeQL: ✅ <count> alerts
    
    **Critical Issues:** <count>
    
    | # | Tool | Severity | File:Line | Issue | Fix Effort |
    |---|------|----------|-----------|-------|-----------|
    | 1 | Cubic | P0 | web/lib/foo.ts:42 | ... | 10 min |
    | ... |
    
    **Cycle 1 Exit Gate:** <BLOCKED | REVIEW NEEDED | MERGEABLE>
    **Confidence Score:** <XX/100>
```

### Phase 1.5: Exit Gate Assessment

```bash
[ ] Calculate confidence score (see PR-2-REVIEW-WORKFLOW.md section 2)
    Score: ___/100
    
    [ ] ≥85 → MERGEABLE (proceed to sign-off)
    [ ] 60-84 → REVIEW NEEDED (proceed to Cycle 2)
    [ ] <60 → BLOCKED (stop, escalate)

[ ] Post exit gate summary to PR:
    "## Cycle 1 Complete
     - Confidence: <score>/100
     - Status: <BLOCKED|REVIEW|MERGEABLE>
     - Matrix: [link]
     - Next: <Cycle 2 or Merge>"
```

---

## CYCLE 2: Fix & Verification

### Phase 2.1: Fix Issues

For each critical/high issue (in priority order):

```bash
# Issue 1
[ ] Read full finding details from tool comment
    File: ___________
    Line: ___________
    Issue: ___________
    
[ ] Open file: vim <file>
[ ] Apply fix
[ ] Save file
[ ] Run local gates immediately:
    [ ] pnpm --filter @hex-yt-intel/web type-check
    [ ] pnpm --filter @hex-yt-intel/web lint
    [ ] pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode working-tree
    
    Expected: ✅ All pass

[ ] Commit fix:
    git add <file>
    git commit -m "fix(<category>): <specific fix>. Closes <Tool>#<issue-num>"
    
    Example: git commit -m "fix(security): add Zod validation to query input. Closes CodeRabbit#1"

# Issue 2
[ ] Repeat above for next issue
[ ] ... (continue for all issues)

# Final check before push
[ ] git log --oneline -5
    Expected: ✅ Shows fix commits
    
[ ] pnpm --filter @hex-yt-intel/web type-check && \
    pnpm --filter @hex-yt-intel/web lint && \
    pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode working-tree
    Expected: ✅ All green
```

### Phase 2.2: Push & Re-trigger Tools

```bash
# Push fixes
[ ] git push origin claude/pr-2-qa-intel-consolidation
    Expected: ✅ pushed
    
# GitHub will automatically re-trigger CI/CD
[ ] Wait 20 minutes for tools to re-scan
    
# Monitor
[ ] gh run list --workflow=ci-cd.yml -L 1 --json status
[ ] gh pr checks <pr-number>
    Expected: ✅ All checks passing
```

### Phase 2.3: Verify Improvements

```
Check PR Comments (New Round)

Cubic:
  [ ] Score improved? (was: ___, now: ___)
  [ ] Issues reduced? (was: ___, now: ___)

CodeRabbit:
  [ ] Previous issues resolved? ✅/❌
  [ ] New issues found? ___

Snyk:
  [ ] Vulnerabilities cleared? ✅/❌

DeepSource:
  [ ] Issues cleared? ✅/❌

CodeQL:
  [ ] Alerts cleared? ✅/❌
```

### Phase 2.4: Update Review Matrix

```bash
[ ] Edit docs/testing/pr-2-cycle-1-review-matrix.md
    Add "CYCLE 2 RESULTS" section with new tool outputs
    
    Example:
    ## Cycle 2 Results (After Fixes)
    
    **Date:** 2026-06-30 15:30
    **Fixes Applied:** 3 commits
    
    | Tool | Before | After | Status |
    |------|--------|-------|--------|
    | Cubic | 12 issues | 1 issue | ✅ improved |
    | CodeRabbit | 8 issues | 0 issues | ✅ resolved |
    | Snyk | 0 issues | 0 issues | ✅ ok |
    | DeepSource | 5 issues | 0 issues | ✅ resolved |
    | CodeQL | 1 alert | 0 alerts | ✅ resolved |
    
    **Confidence Score:** 94/100 → 🟢 MERGEABLE
```

### Phase 2.5: Final Assessment

```bash
[ ] Calculate new confidence score
    Score: ___/100
    Status: ___________
    
    [ ] ≥85 → MERGEABLE (proceed to sign-off)
    [ ] 60-84 → Needs more fixes (return to Phase 2.1)
    [ ] <60 → Escalate (contact owner)

[ ] If ≥85, proceed to sign-off
```

---

## SIGN-OFF & MERGE

### Manual Review Checklist

```
Code Quality:
  [ ] Architecture sound (hexagonal boundaries intact)
  [ ] No over-engineering
  [ ] Consistent with project patterns
  [ ] Performance OK (no regressions)

Security:
  [ ] No new vulnerabilities
  [ ] Input validation present
  [ ] No secrets exposed
  [ ] Auth controls intact

Type Safety:
  [ ] type-check: 0 errors (web + worker)
  [ ] No @ts-ignore (unless documented)
  [ ] Strict mode compliance

Linting:
  [ ] lint: 0 errors
  [ ] Consistent formatting
  [ ] No console.logs in production code

Test Coverage:
  [ ] Unit tests pass (if any changed)
  [ ] Integration tests pass
  [ ] E2E tests pass (if applicable)

CI/CD:
  [ ] All GitHub Actions pass
  [ ] Vercel preview deployed
  [ ] No warnings in build output

qa-intel:
  [ ] 0 critical findings
  [ ] 0 or minor non-critical
```

### Approvals

```bash
# Lead developer approval
[ ] Lead reviews full diff
[ ] Comments resolved
[ ] Approves in PR interface

# Architecture reviewer approval
[ ] Architecture sound
[ ] Patterns consistent
[ ] Approves in PR interface

# Security reviewer approval (if security changes)
[ ] No new vulnerabilities
[ ] Input validation OK
[ ] Approves in PR interface

[ ] All 3 reviewers have approved (or 2 if no security changes)
```

### Merge Execution

```bash
# Transition from draft
[ ] gh pr ready <pr-number>
    Expected: ✅ PR now ready for merge

# Get latest approval
[ ] gh pr view <pr-number> --json reviews
    Expected: ✅ At least 1-2 approved

# Approve in CI
[ ] gh pr review <pr-number> --approve

# Merge
[ ] gh pr merge <pr-number> --squash \
      --body "Consolidates qa-intel ruleset decomposition from Wave 6.
              All review cycles complete (C1+C2).
              Confidence: 94/100.
              Fixes: 3 critical issues, 0 remaining.
              Merged by: [name] on 2026-06-30"
    
    Expected: ✅ Merged and closed

# Verify merge
[ ] git log --oneline main -5
    Expected: ✅ Shows merge commit at top

# Delete branch
[ ] gh pr delete-branch <pr-number>
    [ ] OR manually: git push origin --delete claude/pr-2-qa-intel-consolidation
    
    Expected: ✅ Branch deleted
```

### Post-Merge Verification

```bash
[ ] Pull latest main locally
    git pull origin main

[ ] Verify no CI failures
    [ ] gh run list --workflow=ci-cd.yml -L 1
        Expected: ✅ Latest run on main passes

[ ] Verify local gates still pass
    [ ] pnpm --filter @hex-yt-intel/web type-check
    [ ] pnpm --filter @hex-yt-intel/web lint
    
    Expected: ✅ Both pass

[ ] Check for regressions
    [ ] Any follow-up PRs blocked? (check AGENT_LEDGER.md)
    [ ] Any new alerts? (check GitHub Security tab)

[ ] Update project documentation
    [ ] Mark PR-2 as COMPLETE in .memory/AGENT_LEDGER.md
    [ ] Record any lessons learned
```

---

## TROUBLESHOOTING

### Type-Check Fails Locally

```bash
# Diagnosis
pnpm --filter @hex-yt-intel/web type-check 2>&1 | head -20

# Common fixes
# 1. Missing interface implementation
# 2. Incorrect import path
# 3. Type mismatch in function signature

# Fix & retry
git add <file>
git commit -m "fix(types): ..."
git push origin claude/pr-2-qa-intel-consolidation
```

### Lint Fails

```bash
# Diagnosis
pnpm --filter @hex-yt-intel/web lint 2>&1 | grep "ERROR"

# Common fixes
# 1. Unused variable
# 2. Missing semicolon / formatting
# 3. Import order

# Auto-fix (if possible)
pnpm --filter @hex-yt-intel/web format

# Commit
git add .
git commit -m "chore(lint): auto-format"
git push origin claude/pr-2-qa-intel-consolidation
```

### QA-Intel Reports Critical Issues

```bash
# Diagnosis
pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode full 2>&1 | grep "CRITICAL"

# Fix the issue
# (depends on specific rule violation)
vim <file>
# ... apply fix ...
git add <file>
git commit -m "fix(qa-intel): ..."

# Verify fix
pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode working-tree
```

### Tool Timeout (CodeRabbit, etc.)

```bash
# If tool doesn't comment after 15+ minutes:
# 1. Check GitHub Actions logs for errors
gh run view <run-id> --log | grep -i "error\|timeout"

# 2. If GH Actions passed but tool timed out
#    Assume tool will retry, but don't wait indefinitely

# 3. Proceed with other tools' findings
#    Can manually trigger tool re-scan by pushing empty commit:
git commit --allow-empty -m "Re-trigger tool scan"
git push origin claude/pr-2-qa-intel-consolidation
```

### Merge Conflict (Unlikely but Possible)

```bash
# If main was updated during PR review:
git fetch origin
git rebase origin/main
# (resolve conflicts if any)
git push origin claude/pr-2-qa-intel-consolidation --force-with-lease

# Re-run local gates
pnpm --filter @hex-yt-intel/web type-check && \
pnpm --filter @hex-yt-intel/web lint
```

---

## QUICK COMMAND REFERENCE

### Full Local Preflight
```bash
pnpm --filter @hex-yt-intel/web type-check && \
pnpm --filter youtube-intelligence-worker typecheck && \
pnpm --filter @hex-yt-intel/web lint && \
pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode full && \
echo "✅ ALL GATES PASS"
```

### Quick Check (Working Tree)
```bash
pnpm dlx tsx scripts/verify-quality-engine.ts --base main --mode working-tree
```

### Monitor PR Status
```bash
gh pr checks <pr-number>
```

### View Tool Comments
```bash
gh pr view <pr-number> --comments | less
```

### Create Matrix
```bash
cat > docs/testing/pr-2-cycle-1-review-matrix.md << 'EOF'
# PR-2 Cycle 1 Review Matrix
...
EOF
```

### Merge PR
```bash
gh pr ready <pr-number>
gh pr review <pr-number> --approve
gh pr merge <pr-number> --squash
```

---

## TIMELINE SUMMARY

| Phase | Duration | Owner |
|-------|----------|-------|
| Local Preflight | 10 min | Developer |
| PR Creation | 2 min | Developer |
| Tool Wait (Cycle 1) | 20 min | Automated |
| Issue Collection | 10 min | Developer |
| **Cycle 1 Total** | **~42 min** | |
| Fix Issues (Cycle 2) | 30-60 min | Developer |
| Tool Rerun | 20 min | Automated |
| Verification | 10 min | Developer |
| **Cycle 2 Total** | **~60-90 min** | |
| Sign-Off & Merge | 10 min | Reviewer + Developer |
| **TOTAL END-TO-END** | **~2-2.5 hours** | |

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-30  
**Use in conjunction with:** PR-2-REVIEW-WORKFLOW.md
