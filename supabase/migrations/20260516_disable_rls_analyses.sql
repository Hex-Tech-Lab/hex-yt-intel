-- Enable permissive RLS policies for authenticated analysis operations
-- Allow authenticated users to insert and query their own analyses
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'analyses' AND table_schema = 'public') THEN
    -- Ensure RLS is enabled
    ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS "allow_user_insert_own_analyses" ON public.analyses;
    DROP POLICY IF EXISTS "allow_user_read_own_analyses" ON public.analyses;

    -- Allow authenticated users to insert analyses for themselves
    CREATE POLICY "allow_user_insert_own_analyses"
      ON public.analyses
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    -- Allow authenticated users to read their own analyses
    CREATE POLICY "allow_user_read_own_analyses"
      ON public.analyses
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;
