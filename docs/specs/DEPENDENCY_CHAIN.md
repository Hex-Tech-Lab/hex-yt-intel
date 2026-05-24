# MVP 1.5 Dependency Chain

**Date**: 2026-05-21  
**Phase**: Phase 1→2 Transition Gate  
**Build**: 872f92e  
**Status**: 🚀 **READY FOR FEATURE WORK** (All Tier 0-2 dependencies locked)

---

## Executive Summary

The dependency chain maps infrastructure layers that must remain **stable and locked** before feature development can begin.

**Rule**: Do not start feature work until all Tier 0, Tier 1, and Tier 2 dependencies have passed verification and are marked as LOCKED.

---

## The 4-Tier Dependency Hierarchy

### Tier 0: Build & Deployment ✅ LOCKED

**What**: CI/CD pipeline, Vercel deployment, Node/pnpm versioning

**Dependencies**:
- ✅ CI/CD pipeline (14 commits of battle-tested workflow logic, optimized via Composite Action pattern)
- ✅ Vercel deployment with environment variable injection (dummy secrets in CI, real secrets at runtime)
- ✅ Node 24 + pnpm 11.1.3 (locked in `action.yml`, enforced across all 7 CI jobs)
- ✅ Build succeeds consistently in ~47 seconds
- ✅ All 7 pipeline stages operational (setup, type-check, lint, test, build, security, health-check)

**Verification**:
```bash
# Check action.yml specifies correct versions
grep "NODE_VERSION\|PNPM_VERSION" action.yml
# Expected output: NODE_VERSION=24, PNPM_VERSION=11.1.3

# Verify latest build succeeded
git log --oneline | head -1  # Should be 872f92e
```

**Failure Mode**: If Node/pnpm versions drift, the entire CI pipeline becomes unreliable. **Prevention**: Only update versions in `action.yml`, never in `ci-cd.yml` directly.

---

### Tier 1: Authentication & Security ✅ LOCKED

**What**: Middleware auth gates, RLS enforcement, OAuth providers

**Dependencies**:
- ✅ `web/middleware.ts` with explicit `return` statements on all auth branches (lines: 36, 44, 61, 64)
- ✅ Row-Level Security (RLS) enforced on all sensitive tables:
  - `public.users`
  - `public.analyses`
  - `public.usage_logs`
- ✅ Supabase OAuth configured and tested (Google, GitHub providers active)
- ✅ Test user seeded: `da4381c6-f774-4c99-8f04-2c1c9e27d1fb` (kellybakri@gmail.com)
- ✅ Session persistence working (cookies set correctly via response.cookies.set)

**Verification**:
```bash
# Check middleware has explicit returns
grep -n "return NextResponse" web/middleware.ts | wc -l
# Expected: At least 4 explicit returns

# Verify RLS is enabled
psql (query to Supabase) \
  SELECT schemaname, tablename FROM pg_tables \
  WHERE tablename IN ('users', 'analyses', 'usage_logs') \
  AND schemaname='public';
```

**Failure Mode**: If middleware control flow falls through or RLS is disabled, authentication can be bypassed. **Prevention**: Always add explicit `return` statements. Never disable RLS on sensitive tables.

---

### Tier 2: Rate Limiting & Quota Enforcement ✅ LOCKED

**What**: Redis circuit breaker, dual-tier rate limiting, quota enforcement

**Dependencies**:
- ✅ Redis circuit breaker implemented (graceful degradation if Redis unavailable)
- ✅ Upstash configuration with rotated credentials (old token revoked, new token active in Vercel)
- ✅ Dual-tier rate limiting:
  - Per-minute limit (burst protection): 10 requests/minute per IP
  - Monthly quota (fairness): 3 analyses/free tier, unlimited/pro tier
- ✅ Lua-backed atomic increment with automatic TTL refresh
- ✅ Type coercion utilities to handle string-to-number conversions from Redis
- ✅ Optimistic locking prevents race condition between quota check and database insert

**Verification**:
```bash
# Check Redis circuit breaker in web/lib/redis.ts
grep "try.*catch\|circuit\|fallback" web/lib/redis.ts | head -5

# Verify rate-limit.ts has parseRedisNumber utility
grep -n "parseRedisNumber\|TTL" web/lib/rate-limit.ts | head -3

# Confirm Upstash token is rotated (check Vercel env)
vercel env ls | grep UPSTASH
```

**Failure Mode**: If Redis is unavailable and no circuit breaker exists, all requests fail. If quota enforcement has race conditions, free-tier users can bypass limits. **Prevention**: Keep circuit breaker operational, maintain Lua-backed atomic operations.

---

### Tier 3: Ready for Feature Work ✅ LOCKED

**What**: Database schema, test infrastructure, API structure

**Dependencies**:
- ✅ Supabase schema stable:
  - `public.users` table (id, email, tier, created_at)
  - `public.analyses` table (id, user_id, video_id, analysis_markdown, created_at)
  - `public.usage_logs` table (user_id, action, quota_cost, created_at)
- ✅ Test user seeded and verified
- ✅ API structure ready for new endpoints
- ✅ Health-check endpoint operational: `GET /api/health`
- ✅ Error handling standardized (Sentry breadcrumbs logged)
- ✅ All endpoints validate input via Zod schemas

**Verification**:
```bash
# Check tables exist in Supabase
supabase db list  # Should show users, analyses, usage_logs

# Test health-check endpoint
curl https://hex-yt-intel.vercel.app/api/health
# Expected: 200 OK with system state

# Verify all routes have Zod validation
grep -r "parse.*Schema\|zod" web/app/api/ | wc -l
```

**Failure Mode**: If schema is unstable or missing, feature development requires schema refactoring mid-sprint. **Prevention**: Lock schema before feature work starts.

---

## Feature Development Dependencies (FUTURE)

MVP 1.5 and beyond will have feature-specific dependencies defined when those phases begin. Currently, all foundational infrastructure (Tier 0-3) is stable and locked.

**No feature blockers exist for hex-yt-intel** — the system is production-ready and awaiting next phase requirements.

---

## Layer Interaction Map

```
┌─────────────────────────────────────────────────────┐
│ Tier 3: Feature-Ready (Database + API)              │
├─────────────────────────────────────────────────────┤
│ Depends on: Tier 2 (Rate Limiting is stable)        │
└─────────────────────────────────────────────────────┘
                        ↑
┌─────────────────────────────────────────────────────┐
│ Tier 2: Rate Limiting & Quota (Redis + Lua)         │
├─────────────────────────────────────────────────────┤
│ Depends on: Tier 1 (Auth gates protect endpoints)   │
└─────────────────────────────────────────────────────┘
                        ↑
┌─────────────────────────────────────────────────────┐
│ Tier 1: Auth & Security (Middleware + RLS)          │
├─────────────────────────────────────────────────────┤
│ Depends on: Tier 0 (CI/CD pipeline builds it)       │
└─────────────────────────────────────────────────────┘
                        ↑
┌─────────────────────────────────────────────────────┐
│ Tier 0: Build & Deployment (Node + pnpm + Vercel)  │
├─────────────────────────────────────────────────────┤
│ No dependencies (foundational layer)                │
└─────────────────────────────────────────────────────┘
```

**Rule**: If Tier N fails, all Tier N+1 layers become unreliable. Never skip verification of a lower tier.

---

## Verification Workflow

### At Session Start
1. **Read this document** to understand the dependency chain
2. **Run KNOWN_GOOD_STATE_CHECKLIST.md** to verify Tier 0-3
3. **Check Tier-specific verification commands** above
4. **If any Tier fails**, consult Brittleness Points for recovery

### Before Starting Feature Work
1. **Verify all Tier 0-2 dependencies are locked** (run checklist)
2. **Confirm feature requirements are specified** (product team sign-off)
3. **Verify database schema is approved** (for new features)
4. **Confirm all environment variables are configured**

### Before Merging Any Feature PR
1. **Re-run KNOWN_GOOD_STATE_CHECKLIST.md** to ensure Tier 0-2 still locked
2. **Verify no drift in CI/CD, Auth, or Rate Limiting layers**
3. **Confirm build succeeds in ~47 seconds** (within expected range)

---

## Anti-Patterns to Avoid

### ❌ Don't change Tier 0 during feature work
- **Why**: CI/CD changes affect all developers and all deployments
- **Fix**: Get explicit approval before touching Node/pnpm/action.yml/ci-cd.yml

### ❌ Don't disable RLS for convenience
- **Why**: RLS is the only thing protecting multi-tenant data
- **Fix**: Design schemas with RLS in mind; don't bypass it

### ❌ Don't assume Redis is always available
- **Why**: Production incidents happen; graceful degradation saves the application
- **Fix**: Keep the circuit breaker pattern, test fallback paths

### ❌ Don't start feature work before blockers are resolved
- **Why**: Blocked work creates technical debt and rework
- **Fix**: Follow the Critical Path. Complete native auth migration + vector sync validation.

---

## Rollback Procedures

If a Tier fails and needs rollback:

### Tier 0 Rollback (CI/CD)
```bash
# Revert last commit to action.yml or ci-cd.yml
git revert <commit-hash>
git push origin main
# Vercel will automatically redeploy
```

### Tier 1 Rollback (Auth)
```bash
# Restore middleware.ts from HEAD
git checkout HEAD~1 -- web/middleware.ts
git commit -m "rollback: restore middleware auth gates"
git push origin main
```

### Tier 2 Rollback (Rate Limiting)
```bash
# Restart Redis connection in Upstash console
# Verify circuit breaker catches the error gracefully
# If graceful degradation fails, restore rate-limit.ts
git checkout HEAD~1 -- web/lib/rate-limit.ts
git commit -m "rollback: restore rate limit logic"
git push origin main
```

### Tier 3 Rollback (Database)
```bash
# Drop new tables, restore old schema
supabase db push --reset
# Re-seed test user
supabase db execute < scripts/seed-test-user.sql
```

---

## FAQ

**Q: What if Tier 2 (Rate Limiting) breaks mid-sprint?**  
**A**: The circuit breaker provides 24-48 hours of graceful degradation. Engage on-call to restore Redis, then resume feature work. Don't disable rate limiting to "work around" it.

**Q: Do I need to re-verify all Tiers on every PR?**  
**A**: No, only verify the Tier(s) your PR touches. E.g., if you're adding a feature endpoint, verify Tier 3. If you're touching middleware, verify Tier 1.

**Q: What if the Known Good State checklist shows something failed?**  
**A**: Immediately stop feature work, isolate which Tier failed, consult Brittleness Points in HANDOVER_REPORT_2026-05-21.md, and follow recovery procedures.

---

## Related Documents

- **Known Good State Checklist**: `/docs/ops/KNOWN_GOOD_STATE_CHECKLIST.md` (operational verification)
- **Brittleness Points**: `/docs/history/HANDOVER_REPORT_2026-05-21.md` (failure modes + recovery)
- **Roadmap**: `/ROADMAP.md` (phase timeline and deliverables)
- **Architecture**: `/CLAUDE.md` (ADRs explaining design choices)

---

**Last Updated**: 2026-05-21  
**Export Source**: HANDOVER_REPORT_2026-05-21.md (section: Dependency Chain)  
**Status**: ✅ All Tier 0-3 dependencies locked and stable | Ready for feature development
