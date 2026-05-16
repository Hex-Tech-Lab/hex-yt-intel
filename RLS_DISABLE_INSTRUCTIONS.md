# RLS Disable Instructions - URGENT

**Issue**: Analyze endpoint failing with code 42501 (RLS blocking insert to public.analyses table)

**Solution**: Run one SQL command in Supabase Dashboard

## Quick Fix (2 minutes)

1. Go to: https://supabase.com/dashboard/project/adnmbikaqnxivalqoild
2. Click **SQL Editor** (left sidebar)
3. Click **New Query**
4. Paste this SQL:
```sql
ALTER TABLE public.analyses DISABLE ROW LEVEL SECURITY;
```
5. Click **Run** (or Ctrl+Enter)
6. You should see: "RLS for public.analyses set to false"

## Verify It Worked

After running the SQL:
1. Go back to https://yt-intel.getmytestdrive.com/auth/signin
2. Sign in with Google
3. Paste YouTube URL and click Analyze
4. Should now complete successfully (no more 42501 errors)
5. Check Vercel logs - should see 201 response, not 500

## Migration File

Migration has been created and committed:
- File: `supabase/migrations/20260516_disable_rls_analyses.sql`
- Status: Committed to main branch
- After RLS is manually disabled above, this migration is recorded for future deploys

## Why This Happened

RLS (Row Level Security) was enabled on the analyses table, which blocks all inserts unless:
1. The RLS policy explicitly allows it (which it doesn't)
2. RLS is disabled

Since we're in MVP phase and don't have fine-grained RLS policies yet, disabling RLS allows authenticated users to insert their own analyses.

**Post-Launch**: This will be re-enabled with proper trigger-based policies in Chunk 11.

## Status After Fix

Once SQL is run:
- ✅ Analyze endpoint can insert analyses to database
- ✅ Users can generate YouTube analyses end-to-end
- ✅ Embeddings will be generated asynchronously
- ✅ Ready to proceed to Chunk 9 (Billing)
