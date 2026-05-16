-- Production RLS Fix - Run in Supabase SQL Editor
-- Date: 2026-05-16
-- Purpose: Unblock analyze endpoint (42501 errors)
-- Source: Session analysis findings

-- 1. Disable RLS on users table (allows OAuth signup)
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- 2. Disable RLS on analyses table (allows analysis inserts)
ALTER TABLE public.analyses DISABLE ROW LEVEL SECURITY;

-- 3. Verify RLS is disabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('users', 'analyses');

-- Expected output:
-- tablename  | rowsecurity
-- -----------|------------
-- users      | f
-- analyses   | f
