# Database Seeding & E2E Test Setup

**Version**: 1.0.0  
**Location**: `/docs/ops/DATABASE_SEEDING_E2E.md`  
**Build**: 440fc68  
**Timestamp**: 2026-05-17 17:30 UTC  
**Purpose**: Ensure persistent test user record exists for E2E testing automation

---

## Visual E2E Test Persona Setup

To enable end-to-end test suites to complete without database schema collisions, the Supabase production instance **MUST** contain a persistent test user record.

### Test User Profile

| Field | Value |
|---|---|
| **User ID** | `da4381c6-f774-4c99-8f04-2c1c9e27d1fb` |
| **Email** | `kellybakri@gmail.com` |
| **Tier** | `free` |
| **Status** | Active |
| **Purpose** | E2E test automation bypass user |

### Seeding Instructions

#### Method 1: Supabase Dashboard SQL Editor

1. Go to [Supabase Project Dashboard](https://app.supabase.com) → Project → SQL Editor
2. Create new query and execute:

```sql
-- Insert E2E test user into public.users table
-- Note: RLS must be disabled on users table for INSERT to work
INSERT INTO public.users (id, email, tier, analyses_used, last_reset_date, created_at)
VALUES (
  'da4381c6-f774-4c99-8f04-2c1c9e27d1fb'::uuid,
  'kellybakri@gmail.com',
  'free',
  0,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Verify insertion
SELECT id, email, tier, created_at FROM public.users WHERE id = 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb';
```

3. Confirm output shows one row with the test user details

#### Method 2: Supabase CLI

```bash
supabase db execute "
INSERT INTO public.users (id, email, tier, analyses_used, last_reset_date, created_at)
VALUES (
  'da4381c6-f774-4c99-8f04-2c1c9e27d1fb'::uuid,
  'kellybakri@gmail.com',
  'free',
  0,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;
"
```

### Test Header Injection

When running E2E tests, set the `DEV_BYPASS_TOKEN` environment variable and inject it via the `X-Hex-Test-Secret` header:

```bash
# Set the development bypass token (must match what's in your environment)
export DEV_BYPASS_TOKEN='your-secret-token-here'

# The test suite will use this value to set the X-Hex-Test-Secret header:
# X-Hex-Test-Secret: <value of DEV_BYPASS_TOKEN>
```

This header triggers:
- **`web/middleware.ts`**: Early return before global auth checks (requires DEV_BYPASS_TOKEN env var + constant-time comparison)
- **`web/app/api/analyses/route.ts`**: Use persistent test user ID (requires DEV_BYPASS_TOKEN env var + timingSafeEqual)

### Critical Invariant

The test user ID is **hardcoded, non-random, and persistent**. This ensures:
- ✅ Rate limit database lookups succeed (user exists)
- ✅ Quota checks complete without schema violations
- ✅ Cache hits/misses work properly
- ✅ Analysis records insert with valid foreign key constraint
- ❌ NO synthetic UUID generation (eliminates schema collision errors)

### Running E2E Tests

Once test user is seeded:

```bash
# Navigate to web directory
cd web

# Run Playwright E2E test suite
pnpm playwright test ../docs/testing/visible_production_telemetry.spec.ts --headed --workers=1

# Or run standalone telemetry runner
node ../docs/testing/run_telemetry.mjs
```

### Verification Checklist

After seeding, verify the test user:

```bash
# Query test user in Supabase
supabase db execute "SELECT * FROM public.users WHERE id = 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb';"

# Expected output:
# id                                    | email                 | tier | analyses_used | created_at
# da4381c6-f774-4c99-8f04-2c1c9e27d1fb | kellybakri@gmail.com  | free | 0             | 2026-05-17...
```

---

## Troubleshooting

### Error: "RLS Policy Violation"
**Cause**: RLS (Row Level Security) is enabled on `users` table  
**Fix**: Disable RLS on `users` table in Supabase → Authentication → Policies

### Error: "Duplicate Key Value"
**Cause**: Test user already exists in database  
**Fix**: This is expected; the `ON CONFLICT (id) DO NOTHING` clause handles it gracefully

### Error: "Invalid UUID Format"
**Cause**: Missing `::uuid` cast in SQL  
**Fix**: Ensure the ID column is cast as `::uuid` type in INSERT statement

---

## Related Documentation

- [CLAUDE.md → DATABASE SEEDING & E2E TEST AUTOMATION](../../CLAUDE.md#database-seeding--e2e-test-automation)
- [CRITICAL MIDDLEWARE & BUILD ANTI-PATTERNS](../../CLAUDE.md#critical-middleware--build-anti-patterns)
- [Playwright E2E Test Suite](../testing/visible_production_telemetry.spec.ts)
- [Standalone Telemetry Runner](../testing/run_telemetry.mjs)

---

**Last Updated**: 2026-05-17 17:30 UTC  
**Status**: Ready for implementation
