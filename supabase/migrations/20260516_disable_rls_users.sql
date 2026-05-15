-- Disable RLS on users table to allow OAuth user creation during signup
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
