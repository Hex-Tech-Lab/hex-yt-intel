-- Add role-based access control (RBAC) to users table
-- Replaces fragile email-based admin checks with database column

ALTER TABLE public.users
ADD COLUMN role text NOT NULL DEFAULT 'user';

-- Add constraint: only valid roles
ALTER TABLE public.users
ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'moderator'));

-- Create index on role for faster admin queries
CREATE INDEX IF NOT EXISTS users_role_idx ON public.users(role);

-- Seed initial admin user (if exists)
-- Note: Update with actual admin email after deployment
UPDATE public.users
SET role = 'admin'
WHERE email = 'kellybakri@gmail.com';
