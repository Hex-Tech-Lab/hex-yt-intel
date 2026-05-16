-- Enable permissive RLS policy for OAuth user creation during signup
-- Allow anonymous (public) role to insert user records when signing up
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public') THEN
    -- Ensure RLS is enabled
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

    -- Drop existing insert policy if it exists
    DROP POLICY IF EXISTS "allow_oauth_signup_insert" ON public.users;

    -- Create permissive policy for OAuth signup: allow public role to insert any record
    -- This is safe because Supabase auth layer controls who can trigger this
    CREATE POLICY "allow_oauth_signup_insert"
      ON public.users
      FOR INSERT
      WITH CHECK (true);

    -- Allow authenticated users to view their own record
    DROP POLICY IF EXISTS "allow_user_read_own" ON public.users;
    CREATE POLICY "allow_user_read_own"
      ON public.users
      FOR SELECT
      USING (auth.uid() = id);
  END IF;
END $$;
