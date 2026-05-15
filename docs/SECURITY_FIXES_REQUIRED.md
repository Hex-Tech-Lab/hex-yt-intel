# Security Warnings - Apply These Fixes

Supabase database linter is reporting 4 warnings. 3 can be automatically fixed:

## Status

- ✅ Code prepared (migration file created)
- ⏳ **Needs manual application to production database**
- ⏳ **Needs Facebook OAuth credentials**

## How to Apply Database Fixes

### Option 1: Use Supabase SQL Editor (Easiest)

1. Go to: https://app.supabase.com/project/adnmbikaqnxivalqoild/sql/new
2. Copy & paste the SQL below:

```sql
-- Fix 1: Set search_path for delete_old_free_analyses
CREATE OR REPLACE FUNCTION public.delete_old_free_analyses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.analyses
  WHERE user_id IN (
    SELECT id FROM public.users WHERE tier = 'free'
  )
  AND created_at < NOW() - INTERVAL '30 days';
END;
$$;

-- Fix 2: Set search_path for update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Fix 3: Fix overly permissive RLS policy
DROP POLICY IF EXISTS "Service role can manage stripe events" ON public.stripe_events;

CREATE POLICY "Service role can manage stripe events"
  ON public.stripe_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
```

3. Click "Run"
4. Verify: Go back to SQL Linter (Settings → Database → Linter) - warnings should be gone

### Option 2: Use Supabase CLI

```bash
cd /home/kellyb_dev/projects/hex-yt-intel
supabase db push
```

This will detect the migration file and prompt you to apply it.

### Option 3: Use psql directly

```bash
psql postgresql://postgres:[password]@db.adnmbikaqnxivalqoild.supabase.co:5432/postgres << 'EOF'
-- Paste the SQL from Option 1 above
EOF
```

You'll need the Postgres password (available in Supabase project settings).

## Facebook OAuth Setup

Now that GitHub is removed, you need **Facebook OAuth credentials**:

1. Go to: https://developers.facebook.com
2. Create new app (or use existing)
3. Go to Settings → Basic → Copy App ID + App Secret
4. Go to Settings → OAuth Client Redirect URIs
5. Add: `https://adnmbikaqnxivalqoild.supabase.co/auth/v1/callback`
6. Save

Then add to Supabase:
1. Go to: https://app.supabase.com/project/adnmbikaqnxivalqoild/auth/providers
2. Click "Facebook"
3. Paste App ID + App Secret
4. Enable and Save

## Test After Fixes

```bash
# Deploy updated code with Facebook OAuth
git push
# Wait for Vercel deployment

# Test signin
curl https://hex-yt-intel.vercel.app/auth/signin

# Or visit in browser
# Should show: "Sign in with Google" and "Sign in with Facebook"
```

## Remaining Warning (Not Auto-Fixable)

**Extension in Public Schema** - Vector extension is in `public` schema  
- Can be moved to `extensions` schema, but requires recreating pgvector columns
- This is safe to defer to a future maintenance window
- Doesn't affect security, just schema organization

## References

- Security warnings: https://app.supabase.com/project/adnmbikaqnxivalqoild/settings/database
- Supabase Linter: https://supabase.com/docs/guides/database/database-linter
- Function search_path: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
- RLS policies: https://supabase.com/docs/guides/database/database-linter?lint=0024_permissive_rls_policy
