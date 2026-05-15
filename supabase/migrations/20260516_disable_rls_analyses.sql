-- Disable RLS on analyses table to allow authenticated users to insert their analyses
ALTER TABLE public.analyses DISABLE ROW LEVEL SECURITY;
