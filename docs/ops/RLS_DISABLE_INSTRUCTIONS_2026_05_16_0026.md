---
Filename: RLS_DISABLE_INSTRUCTIONS.md
Location: /docs/ops/
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:13:51 EEST (GCW)
Purpose: RLS DISABLE INSTRUCTIONS
---

# RLS Policy Configuration - SECURE APPROACH

**Issue**: Analyze endpoint failing with code 42501 (RLS blocking insert to public.analyses table)

**Solution**: Create minimal RLS policies using `auth.uid()` authentication context

## Secure Fix (2 minutes)

1. Go to: https://supabase.com/dashboard/project/adnmbikaqnxivalqoild
2. Click **SQL Editor** (left sidebar)
3. Click **New Query**
4. Paste this SQL:

```sql
-- Enable RLS on analyses table (if not already enabled)
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

-- Create policy allowing authenticated users to insert their own analyses
CREATE POLICY "Allow authenticated inserts based on user_id" 
ON public.analyses 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- Create policy allowing users to read only their own analyses
CREATE POLICY "Allow users to read their own analyses" 
ON public.analyses 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- Create policy allowing users to delete only their own analyses
CREATE POLICY "Allow users to delete their own analyses" 
ON public.analyses 
FOR DELETE 
TO authenticated 
USING (auth.uid() = user_id);
```

5. Click **Run** (or Ctrl+Enter)
6. You should see: "Query executed successfully"

## Why This Approach (vs Disabling RLS)

RLS protects multi-tenant data:
- ❌ **DISABLE RLS**: All users can read/modify all analyses (catastrophic security hole)
- ✅ **RLS Policies**: Users can only access their own data via `auth.uid()` context

## Verify It Worked

After running the SQL:
1. Go to https://yt-intel.getmytestdrive.com/auth/signin
2. Sign in with Google
3. Paste YouTube URL and click Analyze
4. Should complete successfully (201 response)
5. Check Vercel logs - no 42501 errors
6. Verify other users cannot see your analyses (RLS enforced at database level)

## Migration File

Migration has been created:
- File: `supabase/migrations/20260516_rls_policies_analyses.sql`
- Status: Implements secure `auth.uid()` policies
- No longer disables RLS (maintains multi-tenant integrity)

## Architecture Post-Launch

RLS policies remain **enabled** with:
- User isolation: Each user sees only their own analyses
- Trigger-based audit logging: Track all modifications
- Scalable: Works for unlimited users without policy changes

## Status After Fix

Once SQL is run:
- ✅ Analyze endpoint can insert analyses securely
- ✅ Users generate analyses end-to-end
- ✅ RLS protects against cross-user data leaks
- ✅ Ready to proceed to Chunk 9 (Billing)
