# PR #1-3 FIX PLAN
## Critical Issues: Security + Build + Performance | Must Fix Before Chunk 7

**Status:** PRs #1-3 CLOSED but NOT MERGED | CHANGES_REQUESTED  
**Blockers:** 9+ critical issues across all 3 PRs  
**Timeline:** 45-60 min to fix + re-verify

---

## CRITICAL ISSUES BREAKDOWN

### SECURITY (P0 + P1)

**Issue 1: RLS Policy on stripe_events (P0 CRITICAL)**
```sql
-- WRONG (current)
CREATE POLICY "Service role can manage stripe events" ON stripe_events
  FOR ALL USING (true);

-- CORRECT (fix)
CREATE POLICY "Service role can manage stripe events" ON stripe_events
  FOR ALL USING (auth.role() = 'service_role');
```
Location: `supabase/migrations/001_initial_schema.sql:106`

**Issue 2: Usage Log RLS Policy (P1)**
```sql
-- Current allows users to write their own billing records
-- Fix: System role only for inserts, users can only read own logs

CREATE POLICY "Users can read own usage logs" ON usage_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role writes usage logs" ON usage_logs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
```
Location: `supabase/migrations/001_initial_schema.sql:89`

---

### BUILD BREAK (P1)

**Issue 3: Tailwind v4 Directive Migration (P1 BUILD BREAK)**
```css
/* WRONG (v3 syntax, causes build break) */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* CORRECT (v4 syntax) */
@import "tailwindcss";
```
Location: `web/app/globals.css:1`  
Impact: **No Tailwind styles will be injected** (silent build break)

---

### PERFORMANCE (P1)

**Issue 4: Cleanup Trigger on Every Insert (P1)**
```sql
-- WRONG: Runs full-table delete on every insert
CREATE TRIGGER trigger_delete_old_analyses
AFTER INSERT ON analyses
FOR EACH STATEMENT
EXECUTE FUNCTION delete_old_free_analyses();

-- CORRECT: Move to scheduled job (pg_cron)
-- Trigger removed from schema
-- Add to supabase/migrations/002_schedule_cleanup.sql:
SELECT cron.schedule(
  'delete-old-free-analyses',
  '0 2 * * *',  -- Daily at 2 AM
  'DELETE FROM analyses
   WHERE user_id IN (SELECT id FROM users WHERE tier = ''free'')
   AND created_at < NOW() - INTERVAL ''30 days'''
);
```
Location: `supabase/migrations/001_initial_schema.sql:122`

---

### DOCUMENTATION (P2)

**Issue 5: Markdown Formatting**
- Add blank lines before/after code blocks
- Add language specifiers (```sql, ```bash, etc.)
- Add blank lines before headings

**Issue 6: Documentation Commands**
- `supabase db list-tables` → use `SELECT * FROM information_schema.tables WHERE table_schema='public'`
- Update pgvector verification query
- Fix RLS verification command

Location: `docs/SUPABASE_SETUP.md` (multiple lines)

**Issue 7: tsconfig.json**
- Set `allowJs: false` (app is TypeScript-only)

Location: `web/tsconfig.json`

---

## FIX EXECUTION PLAN

### BRANCH STRATEGY (No Toe-Stepping)

```
pr1-fix/security     (Issues #1, #2)
pr1-fix/build        (Issue #3)
pr1-fix/performance  (Issue #4)
pr1-fix/docs         (Issues #5, #6, #7)
```

### PHASE 1: SECURITY FIXES (10 min)
```bash
git checkout -b pr1-fix/security

# 1. Fix stripe_events RLS
# File: supabase/migrations/001_initial_schema.sql
# Line 106: USING (true) → USING (auth.role() = 'service_role')

# 2. Fix usage_logs RLS
# File: supabase/migrations/001_initial_schema.sql
# Line 89: Split policy into read (user) + write (service_role)

# Commit
git add supabase/migrations/001_initial_schema.sql
git commit -m "fix(security): RLS policies for stripe_events and usage_logs

- stripe_events: Service role only (USING auth.role() = 'service_role')
- usage_logs: Users read own logs, service role writes logs
- Prevents users from tampering with billing records
- Restricts payment event access to authorized roles only"
```

### PHASE 2: BUILD FIX (5 min)
```bash
git checkout -b pr1-fix/build

# 1. Fix Tailwind v4 directive
# File: web/app/globals.css
# Line 1-3: Replace @tailwind directives with @import "tailwindcss"

# Commit
git add web/app/globals.css
git commit -m "fix(build): migrate Tailwind CSS to v4 directive

- Replace v3 @tailwind directives with v4 @import entrypoint
- Ensures Tailwind base, component, and utility styles are injected
- Fixes silent build break where styles were not applied"
```

### PHASE 3: PERFORMANCE FIX (10 min)
```bash
git checkout -b pr1-fix/performance

# 1. Remove trigger from main migration
# File: supabase/migrations/001_initial_schema.sql
# Remove lines 108-125 (trigger creation)

# 2. Create scheduled cleanup migration
# File: supabase/migrations/002_schedule_cleanup.sql (NEW)
# Add pg_cron job for daily cleanup at 2 AM

# Commit
git add supabase/migrations/001_initial_schema.sql
git commit -m "fix(performance): move cleanup from trigger to scheduled job

- Remove AFTER INSERT trigger on analyses table
- Replaces full-table scan on every insert with daily pg_cron job
- Reduces insert latency, prevents unpredictable performance
- Scheduled for 2 AM UTC (off-peak hours)

Related: Sourcery-ai, cubic-dev-ai"

git add supabase/migrations/002_schedule_cleanup.sql
git commit -m "feat(database): add pg_cron scheduled job for cleanup

- Daily job: delete free-tier analyses older than 30 days
- Executes at 2 AM UTC (off-peak)
- Removes performance burden from insert critical path"
```

### PHASE 4: DOCUMENTATION FIXES (10 min)
```bash
git checkout -b pr1-fix/docs

# 1. Fix Tailwind globals.css formatting
# File: docs/SUPABASE_SETUP.md
# - Add ```css code blocks with formatting
# - Add blank lines around code blocks

# 2. Fix CLI commands
# - Replace supabase db list-tables with valid alternative
# - Update pgvector verification query
# - Update RLS verification command

# 3. Fix tsconfig.json
# File: web/tsconfig.json
# Set allowJs: false

# Commit
git add docs/SUPABASE_SETUP.md web/tsconfig.json
git commit -m "docs/fix: markdown formatting, CLI commands, tsconfig

- Add blank lines before/after code blocks for readability
- Add language specifiers (```sql, ```bash) for syntax highlighting
- Replace invalid supabase db list-tables with information_schema query
- Update pgvector and RLS verification commands
- Set allowJs: false in tsconfig (TypeScript-only project)

Related: CodeRabbit, cubic-dev-ai"
```

---

## RE-VERIFICATION AFTER FIXES

```bash
# After each branch merges to main:
pnpm run type-check       # Should: 0 errors
pnpm run build            # Should: succeed
pnpm run dev              # Should: start without Tailwind errors

# Check GitHub review tools:
# 1. CodeRabbit: Should show fewer comments
# 2. SonarCloud: Should pass quality gate
# 3. Snyk: Should show no critical vulnerabilities
# 4. GitHub Actions: Should pass all checks
```

---

## MERGE ORDER

1. **pr1-fix/security** → main (fixes P0 critical)
2. **pr1-fix/build** → main (fixes build break)
3. **pr1-fix/performance** → main (fixes latency issue)
4. **pr1-fix/docs** → main (fixes documentation)

After all merged:
- Re-run review tools
- If all green: **PR #1 APPROVED & MERGED**
- Then proceed to PR #2-3 fixes
- Then proceed to **Chunk 7**

---

## TIMELINE

```
Phase 1 (Security):     10 min
Phase 2 (Build):        5 min
Phase 3 (Performance):  10 min
Phase 4 (Docs):         10 min
Re-verification:        10 min
Review tool re-run:     5-10 min
Merge to main:          5 min
─────────────────────────────
TOTAL:                  45-60 min
```

---

## CRITICAL RULE

**Do NOT proceed to Chunk 7 until:**
1. ✅ All security issues fixed
2. ✅ Build passes with Tailwind v4
3. ✅ Performance optimized (no trigger)
4. ✅ Documentation accurate
5. ✅ All review tools PASS
6. ✅ PR #1 MERGED to main

**This ensures production-ready code.**

---

**STATUS:** Ready to execute phase 1. Awaiting confirmation.
