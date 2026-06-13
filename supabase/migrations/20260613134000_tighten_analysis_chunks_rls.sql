-- Tighten RLS policies on analysis_chunks table
-- Drop legacy broad policy
DROP POLICY IF EXISTS "Users can manage their own analysis chunks" ON public.analysis_chunks;

-- Policy: Users can only SELECT chunks belonging to their own analyses
CREATE POLICY "Users can select their own analysis chunks" ON public.analysis_chunks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE public.analyses.id = public.analysis_chunks.analysis_id
      AND public.analyses.user_id = auth.uid()
    )
  );

-- Policy: Only service role can INSERT, UPDATE, or DELETE chunks (no public write access)
-- Note: Supabase service_role automatically bypasses RLS policies. 
-- By not defining any INSERT/UPDATE/DELETE policies for public users, we completely disable direct write access.
