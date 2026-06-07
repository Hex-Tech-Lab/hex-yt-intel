-- Wave 4: Optimize analyses table queries and enforce user foreign key
-- Composite index for history pagination (user_id + created_at DESC)
CREATE INDEX IF NOT EXISTS idx_analyses_user_created
  ON public.analyses (user_id, created_at DESC);

-- Add foreign key from public.users to auth.users (idempotent via NOT VALID).
-- NOT VALID skips full table validation, allowing incremental VALIDATE CONSTRAINT later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_id_fkey'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_id_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
